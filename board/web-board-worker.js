// 인터넷 전광판, drawn in a worker: the map page next to it (map, simulator, traffic) can be busy without the scrolling
// waiting for it. web-board.html hands this worker its canvas (OffscreenCanvas) and the screen size; it runs the scenes
// of omsiledcode.ino (from BusLive web/ride.html, styles 1111 to 4444) and takes the sign's own commands from the map
// page over the BroadcastChannel 'led-web-board': R: route, I: stop, CFG: style.
// Also loaded as a plain script by web-board.html where workers cannot draw (no OffscreenCanvas): then self is window.
self.window = self.window || self;
const W = 128, H = 32;
const COLOR = { white: [255, 255, 255], green: [0, 255, 0], cyan: [0, 180, 255], yellow: [255, 255, 0], red: [255, 0, 0], orange: [255, 120, 0],
  oldGreen: [35, 110, 0], oldRed: [255, 60, 0], oldYellow: [220, 120, 0] };
let gStyle = '1111';      // 1111 new, 2222 old, 3333 = 1111 with yellow for white, 4444 flat
function mapStyleColor(c) {
  if (gStyle === '1111') return c;
  if (gStyle === '3333' || gStyle === '4444') return c === COLOR.white ? COLOR.yellow : c;
  if (c === COLOR.white) return COLOR.orange;
  if (c === COLOR.yellow) return COLOR.oldYellow;
  if (c === COLOR.green) return COLOR.oldGreen;
  if (c === COLOR.red) return COLOR.oldRed;
  return c;
}
function stationBotColor() {
  if (gStyle === '1111') return COLOR.white;
  if (gStyle === '3333' || gStyle === '4444') return COLOR.yellow;
  return mapStyleColor(COLOR.white);
}
const SCROLL_DELAY = 8, AD_FAST_SCROLL_DELAY = 7;
const DRAW_MS = 10;
const AD_SHOW_PCT = 40, AD_COUNT = 6, AD_SAFE_EXIT = 4;      // 안전하차안내: only in 2222 and 4444
const STATION_TITLE_Y = 12;
let ADS = null;

/* ---- u8g2 fonts ---- */
function makeFont(b64) {
  const f = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return { f, bits0: f[2], bits1: f[3], bitsW: f[4], bitsH: f[5], bitsX: f[6], bitsY: f[7], bitsD: f[8],
    startA: (f[17] << 8) | f[18], startLowerA: (f[19] << 8) | f[20], startUni: (f[21] << 8) | f[22], cache: new Map() };
}
let HANGUL_FONT = null, ASCII_FONT = null;
const made = {};
let BASE = '';
function loadScript(name) {
  if (typeof importScripts === 'function') {
    try { importScripts(BASE + name); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
  }
  return new Promise(done => {
    const tag = document.createElement('script');
    tag.src = BASE + name;
    tag.onload = () => done(true);
    tag.onerror = () => done(false);
    document.head.appendChild(tag);
  });
}
async function loadFont(id) {
  if (made[id]) return made[id];
  if (!self.RIDE_FONTS || !self.RIDE_FONTS[id]) {
    if (!(await loadScript(`ridefont_${id}.js`))) return null;
  }
  return made[id] = makeFont(self.RIDE_FONTS[id]);
}
async function useFonts(id, en) {
  const kr = await loadFont(id), latin = await loadFont(en);
  if (kr) HANGUL_FONT = kr;
  if (latin) ASCII_FONT = latin;
}

function glyphAt(F, enc) {
  const font = F.f;
  let p = 23;
  if (enc <= 255) {
    if (enc >= 97) p += F.startLowerA; else if (enc >= 65) p += F.startA;
    for (;;) {
      if (font[p + 1] === 0) break;
      if (font[p] === enc) return p + 2;
      p += font[p + 1];
    }
  } else {
    p += F.startUni;
    let t = p, e;
    do {
      p += (font[t] << 8) | font[t + 1];
      e = (font[t + 2] << 8) | font[t + 3];
      t += 4;
    } while (e < enc);
    for (;;) {
      e = (font[p] << 8) | font[p + 1];
      if (e === 0) break;
      if (e === enc) return p + 3;
      p += font[p + 2];
    }
  }
  return -1;
}

function glyph(F, enc) {
  if (F.cache.has(enc)) return F.cache.get(enc);
  const p0 = glyphAt(F, enc);
  let g = null;
  if (p0 >= 0) {
    const font = F.f;
    let p = p0, pos = 0;
    const u = cnt => {
      let v = font[p] >> pos, n = pos + cnt;
      if (n >= 8) { p++; v = (v | (font[p] << (8 - pos))) & 0xFF; n -= 8; }
      pos = n;
      return v & ((1 << cnt) - 1);
    };
    const s = cnt => u(cnt) - (1 << (cnt - 1));
    const w = u(F.bitsW), h = u(F.bitsH), x = s(F.bitsX), y = s(F.bitsY), d = s(F.bitsD), runs = [];
    if (w > 0) {
      let lx = 0, ly = 0;
      const decode = (len, fg) => {
        let cnt = len;
        for (;;) {
          const rem = w - lx, cur = cnt < rem ? cnt : rem;
          if (cur > 0 && fg) runs.push([lx, ly, cur]);
          if (cnt < rem) break;
          cnt -= rem; lx = 0; ly++;
        }
        lx += cnt;
      };
      for (;;) {
        const a = u(F.bits0), c = u(F.bits1);
        do { decode(a, false); decode(c, true); } while (u(1) !== 0);
        if (ly >= h) break;
      }
    }
    g = { w, h, x, y, d, runs };
  }
  F.cache.set(enc, g);
  return g;
}

/* ---- the panel: lit lamps over a dark board of unlit lamps ---- */
let led = null, ctx = null, k = 4;
const makeCanvas = (w, h) => typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
const small = makeCanvas(W, H), sctx = small.getContext('2d');
const img = sctx.createImageData(W, H), fb = img.data;
let mask = null, unlit = null;

function matrixFillScreen() { for (let i = 0; i < fb.length; i += 4) { fb[i] = fb[i + 1] = fb[i + 2] = 0; fb[i + 3] = 255; } }
function matrixShow() {
  if (!ctx) return;
  sctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, led.width, led.height);
  if (mask) ctx.drawImage(mask, 0, 0);
  if (unlit) { ctx.globalCompositeOperation = 'lighten'; ctx.drawImage(unlit, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
}
// round lamps on a k-pixel pitch; between them the black board with a faint grid, and every unlit lamp just visible
function fit(pxW, pxH) {
  if (!led) return;
  k = Math.max(2, Math.floor(Math.min(pxW / W, pxH / H)));
  led.width = W * k; led.height = H * k;
  mask = makeCanvas(led.width, led.height);
  const m = mask.getContext('2d');
  m.fillStyle = '#000';
  m.fillRect(0, 0, mask.width, mask.height);
  m.globalCompositeOperation = 'destination-out';
  m.beginPath();
  const r = k * 0.42;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { m.moveTo(x * k + k / 2 + r, y * k + k / 2); m.arc(x * k + k / 2, y * k + k / 2, r, 0, 7); }
  m.fill();
  unlit = makeCanvas(led.width, led.height);
  const u = unlit.getContext('2d');
  if (k >= 4) {                                   // the grid between lamps (too fine to see on a small board)
    u.strokeStyle = '#0d0d0d';
    u.lineWidth = Math.max(1, Math.round(k * 0.08));
    u.beginPath();
    for (let x = 0; x <= W; x++) { u.moveTo(x * k + 0.5, 0); u.lineTo(x * k + 0.5, led.height); }
    for (let y = 0; y <= H; y++) { u.moveTo(0, y * k + 0.5); u.lineTo(led.width, y * k + 0.5); }
    u.stroke();
  }
  u.fillStyle = '#1b1b1b';
  u.beginPath();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { u.moveTo(x * k + k / 2 + r, y * k + k / 2); u.arc(x * k + k / 2, y * k + k / 2, r, 0, 7); }
  u.fill();
  matrixShow();
}

function print(F, str, x, y, col) {
  for (const ch of String(str)) {
    const g = glyph(F, ch.codePointAt(0) & 0xFFFF);
    if (!g) continue;
    const ox = x + g.x, oy = y - (g.h + g.y);
    for (const [lx, ly, len] of g.runs) {
      const py = oy + ly;
      if (py < 0 || py >= H) continue;
      for (let i = 0; i < len; i++) {
        const px = ox + lx + i;
        if (px < 0 || px >= W) continue;
        const q = (py * W + px) * 4;
        fb[q] = col[0]; fb[q + 1] = col[1]; fb[q + 2] = col[2];
      }
    }
    x += g.d;
  }
}
const isAsciiText = s => /^[\x00-\x7f]*$/.test(s);
function printBold(str, x, y, col) { print(isAsciiText(str) ? ASCII_FONT : HANGUL_FONT, str, x, y, col); }
function getUTF8Width(str) {
  let w = 0, dx = 0, gw = 0, gx = 0;
  for (const ch of String(str)) {
    const g = glyph(HANGUL_FONT, ch.codePointAt(0) & 0xFFFF);
    dx = 0;
    if (g) { dx = g.d; gw = g.w; gx = g.x; }
    w += dx;
  }
  if (gw !== 0) { w -= dx; w += gw; w += gx; }
  return w;
}
const dim = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

/* ---- time ---- */
let interrupt = false;
const later = ms => new Promise(r => setTimeout(r, ms));
async function responsiveDelay(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (interrupt) return true;
    await later(Math.min(16, end - performance.now()));
  }
  return interrupt;
}
// Each step lasts a whole number of screen frames (18 ms -> 1 frame at 60 Hz, 35 ms -> 2), so pixel steps land evenly.
let frameMs = 1000 / 60;
const hasRaf = typeof requestAnimationFrame === 'function';
(function measureFrames() {
  if (!hasRaf) return;
  let n = 0, t0 = 0;
  const tick = t => { if (n === 0) t0 = t; if (++n < 31) requestAnimationFrame(tick); else if (t > t0) frameMs = (t - t0) / 30; };
  requestAnimationFrame(tick);
})();
const nextFrame = () => new Promise(r => { if (hasRaf) requestAnimationFrame(r); setTimeout(r, hasRaf ? 100 : frameMs); });
async function steps(n, msPerStep, each) {
  const per = Math.max(1, Math.round(msPerStep / frameMs));
  const t0 = performance.now();
  let done = -1;
  while (done < n - 1) {
    if (interrupt) return true;
    const frames = Math.round((performance.now() - t0) / frameMs);
    const i = Math.min(n - 1, Math.floor(frames / per));
    if (i !== done) { done = i; each(i); matrixShow(); }
    if (done < n - 1) await nextFrame();
  }
  return interrupt;
}

/* ---- scenes ---- */
let last = null;
const isStationSceneTitle = t => t === '이번정류소' || t === '다음정류소' || t === 'THIS STOP' || t === 'NEXT STOP';
const stationTitleY = t => isStationSceneTitle(t) ? STATION_TITLE_Y : 13;
const stationCenterX = w => Math.max(0, Math.floor((W - w) / 2));
const scrollEndX = w => W - 2 - w;
const stationPartialLeftX = w => Math.floor((4 + stationCenterX(w)) / 2);
const stationStaticNameX = w => (gStyle === '1111' || gStyle === '3333') ? stationCenterX(w) : w >= 120 ? 0 : stationPartialLeftX(w);

function sceneDraw(top, bot, tCol, botCol, x, f = 1, topX = stationCenterX(getUTF8Width(top))) {
  const topY = stationTitleY(top);
  return o => {
    printBold(top, topX, topY + o, dim(tCol, f));
    printBold(bot, x, 28 + o, dim(botCol, f));
  };
}
function show(draw, o = 0) { matrixFillScreen(); draw(o); matrixShow(); }

async function fadeEffect(top, bot, tCol, botCol, x, out, delayMs = 30) {
  return steps(16, delayMs, i => {
    matrixFillScreen();
    sceneDraw(top, bot, tCol, botCol, x, (out ? 15 - i : i) / 15)(0);
  });
}

async function sceneBody(top, bot, tCol, botCol, moveOut, x0) {
  const botW = getUTF8Width(bot);
  let x = x0;
  last = sceneDraw(top, bot, tCol, botCol, x);
  if (botW > W) {
    if (await responsiveDelay(1500)) return true;
    const end = scrollEndX(botW);
    if (await steps(4 - end + 1, SCROLL_DELAY + DRAW_MS, i => {
      x = 4 - i;
      last = sceneDraw(top, bot, tCol, botCol, x);
      matrixFillScreen(); last(0);
    })) return true;
    if (await responsiveDelay(1500)) return true;
  } else if (await responsiveDelay(3000)) return true;
  if (moveOut) {
    return steps(33, 35, i => { matrixFillScreen(); last(-i); });
  }
  return fadeEffect(top, bot, tCol, botCol, x, true);
}

async function showScene(top, bot, tCol, moveIn, moveOut) {
  tCol = mapStyleColor(tCol);
  const botCol = stationBotColor(), botW = getUTF8Width(bot), x0 = botW > W ? 4 : stationStaticNameX(botW);
  if (moveIn) {
    const draw = sceneDraw(top, bot, tCol, botCol, x0);
    last = draw;
    if (await steps(33, 35, i => { matrixFillScreen(); draw(32 - i); })) return true;
  } else {
    last = sceneDraw(top, bot, tCol, botCol, x0);
    if (await fadeEffect(top, bot, tCol, botCol, x0, false)) return true;
  }
  return sceneBody(top, bot, tCol, botCol, moveOut, x0);
}

async function transitionUp(top, bot, tCol) {
  tCol = mapStyleColor(tCol);
  const old = last, botCol = stationBotColor(), botW = getUTF8Width(bot), x0 = botW > W ? 4 : stationStaticNameX(botW);
  const draw = sceneDraw(top, bot, tCol, botCol, x0);
  if (await steps(33, 35, i => { matrixFillScreen(); old(-i); draw(32 - i); })) return true;
  return sceneBody(top, bot, tCol, botCol, false, x0);
}

async function showSceneOldStyle(top, bot) {
  const tCol = COLOR.oldGreen, botCol = mapStyleColor(COLOR.white), botW = getUTF8Width(bot), topW = getUTF8Width(top);
  const topX = botW > W ? stationCenterX(topW) : stationPartialLeftX(topW);
  if (botW <= W) {
    last = sceneDraw(top, bot, tCol, botCol, stationStaticNameX(botW), 1, topX);
    show(last);
    return responsiveDelay(3000);
  }
  last = sceneDraw(top, bot, tCol, botCol, 4, 1, topX);
  show(last);
  if (await responsiveDelay(1500)) return true;
  return steps(4 + botW + 1, SCROLL_DELAY + DRAW_MS, i => {
    last = sceneDraw(top, bot, tCol, botCol, 4 - i, 1, topX);
    matrixFillScreen(); last(0);
  });
}

async function showSceneFlat(top, bot, tCol) {
  tCol = mapStyleColor(tCol);
  const botCol = stationBotColor(), botW = getUTF8Width(bot);
  last = sceneDraw(top, bot, tCol, botCol, botW > W ? 4 : stationStaticNameX(botW));
  show(last);
  if (botW > W) {
    if (await responsiveDelay(1500)) return true;
    if (await steps(4 + botW + 1, SCROLL_DELAY + DRAW_MS, i => {
      last = sceneDraw(top, bot, tCol, botCol, 4 - i);
      matrixFillScreen(); last(0);
    })) return true;
  } else if (await responsiveDelay(3000)) return true;
  matrixFillScreen(); matrixShow();
  return false;
}

/* ---- ads ---- */
function segLineWidth(segs) {
  let x = 0;
  for (const [t] of segs) x += getUTF8Width(t) + 1;
  return x > 0 ? x - 1 : 0;
}
function drawSegLine(segs, x, y, f = 1) {
  for (const [t, c] of segs) {
    printBold(t, x, y, dim(mapStyleColor(COLOR[c]), f));
    x += getUTF8Width(t) + 1;
  }
}
async function showMultiColorAdEx(top, bot, scrollDelay, holdScrollMs, holdStaticMs, fadeDelayMs, noScroll = false) {
  const topW = segLineWidth(top), botW = segLineWidth(bot);
  const topX = top[0][0][0] === '*' ? 0 : topW > W ? 4 : Math.floor((W - topW) / 2);
  const startX = botW > W ? 4 : Math.floor((W - botW) / 2);
  let x = startX;
  const frame = f => o => { drawSegLine(top, topX, 13 + o, f); drawSegLine(bot, x, 28 + o, f); };
  last = frame(1);
  if (gStyle === '4444') {
    show(last);
    if (botW <= W) return responsiveDelay(holdStaticMs);
    if (await responsiveDelay(holdScrollMs)) return true;
    return steps(startX + botW + 1, scrollDelay + DRAW_MS, i => { x = startX - i; matrixFillScreen(); frame(1)(0); });
  }
  if (await steps(16, fadeDelayMs, i => { matrixFillScreen(); frame(i / 15)(0); })) return true;
  if (noScroll) {
    if (await responsiveDelay(3000)) return true;
  } else if (botW > W) {
    if (await responsiveDelay(holdScrollMs)) return true;
    if (await steps(4 - (W - botW) + 1, scrollDelay + DRAW_MS, i => { x = 4 - i; matrixFillScreen(); frame(1)(0); })) return true;
    if (await responsiveDelay(holdScrollMs)) return true;
  } else if (await responsiveDelay(holdStaticMs)) return true;
  return steps(16, fadeDelayMs, i => { matrixFillScreen(); frame((15 - i) / 15)(0); });
}
function showAdPoolIndex(which) {
  if (which === 0) return showMultiColorAdEx(ADS.AD0_TOP, ADS.AD0_BOT, 4, 1500, 3000, 30);
  if (which === 1) return showMultiColorAdEx(ADS.AD1_TOP, ADS.AD1_BOT, 3, 250, 500, 10);
  if (which === 2) return showMultiColorAdEx(ADS.AD2_TOP, ADS.AD2_BOT, 5, 250, 500, 10);
  if (which === 3) return showMultiColorAdEx(ADS.AD3_TOP, ADS.AD3_BOT, 4, 700, 1400, 18, true);
  if (which === 4) return showMultiColorAdEx(ADS.AD4_TOP, ADS.AD4_BOT, AD_FAST_SCROLL_DELAY, 700, 1400, 18);
  return false;
}
// which ad, if any: 안전하차안내 only in 2222 and 4444
function pickAd() {
  if (Math.random() * 100 >= AD_SHOW_PCT) return -1;
  const pool = [];
  for (let i = 0; i < AD_COUNT; i++) if (i !== AD_SAFE_EXIT || gStyle === '2222' || gStyle === '4444') pool.push(i);
  return pool[Math.floor(Math.random() * pool.length)];
}
async function showAdOldOnce(which) {
  const top = ADS[which === 1 || which === 4 ? `AD${which}_OLD_TOP` : `AD${which}_TOP`];
  const bot = ADS[which === 1 || which === 4 ? `AD${which}_OLD_BOT` : `AD${which}_BOT`];
  const topW = segLineWidth(top), botW = segLineWidth(bot);
  const topX = top[0][0][0] === '*' ? 0 : Math.max(0, Math.floor((W - topW) / 2));
  const delay = [4, 3, 4, 4][which] ?? AD_FAST_SCROLL_DELAY;
  let x = botW <= W ? Math.max(0, Math.floor((W - botW) / 2)) : 4;
  const frame = () => o => { drawSegLine(top, topX, 13 + o); drawSegLine(bot, x, 28 + o); };
  last = frame();
  show(last);
  if (botW <= W) return responsiveDelay(1400);
  if (await responsiveDelay(700)) return true;
  return steps(4 + botW + 1, delay + DRAW_MS, i => { x = 4 - i; matrixFillScreen(); frame()(0); });
}

/* ---- the sequence of one stop, as after a T on the board ---- */
let isShowing = false, wantStyle = '1111';
const wantFont = 'dunggeunmo16', wantEn = 'dkbascii16';
async function playStop(r, wasShowing) {
  gStyle = wantStyle;
  await useFonts(wantFont, wantEn);
  const isTerminal = !r.next_kr || r.next_kr === '종 점';
  const finish = () => { isShowing = false; last = null; matrixFillScreen(); matrixShow(); };
  isShowing = true;
  if (gStyle === '2222') {
    const which = pickAd();
    for (let i = 0; i < 2; i++) {
      if (await showSceneOldStyle('이번정류소', r.kr)) return;
      if (!isTerminal && await showSceneOldStyle('다음정류소', r.next_kr)) return;
      if (await showSceneOldStyle('THIS STOP', r.en)) return;
      if (which >= 0 && await showAdOldOnce(which)) return;
    }
    return finish();
  }
  if (gStyle === '4444') {
    const once = async () => {
      if (await showSceneFlat('이번정류소', r.kr, COLOR.green)) return true;
      if (!isTerminal && await showSceneFlat('다음정류소', r.next_kr, COLOR.green)) return true;
      return showSceneFlat('THIS STOP', r.en, COLOR.green);
    };
    if (await once()) return;
    const which = pickAd();
    if (which >= 0 && await showAdPoolIndex(which)) return;
    if (await once()) return;
    return finish();
  }
  if (wasShowing && last) { if (await transitionUp('이번정류소', r.kr, COLOR.green)) return; }
  else if (await showScene('이번정류소', r.kr, COLOR.green, true, false)) return;
  if (!isTerminal && await showScene('다음정류소', r.next_kr, COLOR.cyan, false, false)) return;
  if (await showScene('THIS STOP', r.en, COLOR.green, false, false)) return;
  const which = pickAd();
  if (which >= 0 && await showAdPoolIndex(which)) return;
  if (await showScene('이번정류소', r.kr, COLOR.green, false, true)) return;
  finish();
}

function drawWaiting() {
  const t = 'LED init. V3.2a';
  last = null;
  matrixFillScreen();
  printBold(t, stationCenterX(getUTF8Width(t)), 19, COLOR.red);
  matrixShow();
}

/* ---- the LED site's commands ---- */
let route = [], running = null, ready = false;
const pending = [];
async function showStop(i) {
  const s = route[i];
  if (!s) return;
  const n = route[i + 1];
  const r = { kr: s.kr, en: s.en, next_kr: n ? n.kr : '' };
  const was = isShowing;
  interrupt = true;
  if (running) await running;
  interrupt = false;
  running = playStop(r, was).then(() => { running = null; });
}
function onLine(line) {
  if (!ready) { pending.push(line); return; }
  line = String(line || '').trim();
  let m;
  if ((m = /^CFG:(1111|2222|3333|4444)$/.exec(line))) { wantStyle = m[1]; return; }
  if (line.startsWith('R:')) {
    const body = line.slice(2), bar = body.indexOf('|');
    route = (bar < 0 ? '' : body.slice(bar + 1)).split(';').filter(Boolean).map(p => {
      const c = p.indexOf(',');
      return c < 0 ? { kr: p, en: '' } : { kr: p.slice(0, c), en: p.slice(c + 1) };
    });
    return;
  }
  if ((m = /^I:(\d+)$/.exec(line))) showStop(Number(m[1]));
}
const channel = new BroadcastChannel('led-web-board');
channel.onmessage = e => {
  const d = e.data || {};
  if (d.type === 'led-line') onLine(d.line);
  else if (d.type === 'led-state') (d.lines || []).forEach(onLine);
};
function setStyle(code) {             // typed on the board: 4444 and Enter
  if (!/^(1111|2222|3333|4444)$/.test(code)) return;
  wantStyle = code;
  channel.postMessage({ type: 'style', code });
}

async function start(canvas, base, pxW, pxH) {
  BASE = base || '';
  led = canvas; ctx = led.getContext('2d');
  if (!self.RIDE_DATA) await loadScript('ride_data.js');
  ADS = self.RIDE_DATA.ads;
  fit(pxW, pxH);
  matrixFillScreen();
  await useFonts(wantFont, wantEn);
  ready = true;
  drawWaiting();
  pending.splice(0).forEach(onLine);
  channel.postMessage({ type: 'hello' });     // the map page answers with the route and stop it last sent
}

if (typeof importScripts === 'function') {    // in a worker: web-board.html talks to it
  self.onmessage = e => {
    const d = e.data || {};
    if (d.type === 'init') start(d.canvas, d.base, d.w, d.h);
    else if (d.type === 'size') fit(d.w, d.h);
    else if (d.type === 'style') setStyle(d.code);
  };
} else {
  self.webBoard = { start, fit, setStyle };
}
