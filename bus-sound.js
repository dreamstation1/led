/* 버스 소리: the simulation sounds like riding a real bus.
   The sounds are the OMSI 2 buses' own (engine/motor loops with their volume and pitch curves, doors, brakes,
   bells, card taps), the same set as BusLive's busride.html. mobile-patch.js's simulation feeds the speed and the
   distance to the next stop (busSound.feed), asks how long to stand at a stop (busSound.arrive) and starts/stops it. */
(function () {
  const DIR = 'bus-sound/';
  const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } };
  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch (e) { return d; } };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const GROUPS = [['master', '전체', 2], ['eng', '엔진', 1.5], ['ac', '에어컨', 2], ['road', '도로', 1.5], ['fx', '문·카드·벨', 1.5]];   // 1 = 100%, up to 10 = 1000%
  const cfg = Object.assign({ on: true, veh: 'hyundai', bell: 'auto', tagless: false, mix: {} }, load('busSoundCfg', {}));
  GROUPS.forEach(([k, , d]) => { if (cfg.mix[k] == null) cfg.mix[k] = d; });
  const save = () => keep('busSoundCfg', cfg);

  let VEH = {};
  const vehReady = fetch(DIR + 'ride_vehicles.json?v=2').then(r => r.json()).then(d => { VEH = d; }).catch(() => { /* only the Hyundai */ });
  const V = () => cfg.veh !== 'hyundai' ? VEH[cfg.veh] : null;
  const S = k => { const v = V(); return v && v.one[k] ? v.one[k].replace(/^rs_/, '') : k; };
  const BELL_OF = { hyundai: 'bell', eleccity: 'bell', daewoo: 'bell_dw', daewoo110: 'bell_dw', daewoo_old: 'bell_dw2', woojin: 'bell_wj', kgm: 'bell_kgm', higer: 'bell_hg' };
  const FIXED_BELLS = [['bell', '현대 (뉴슈퍼에어로시티)'], ['bell_dw', '대우 BS 올스타 (BELLRC)'], ['bell_dw2', '대우 (구형)'], ['bell_wj', '우진산전'], ['bell_kgm', 'KGM'], ['bell_hg', '하이거']];
  const bellName = () => {
    if (cfg.bell !== 'auto') return cfg.bell;
    const v = V();
    return v && v.one.bell ? v.one.bell.replace(/^rs_/, '') : BELL_OF[cfg.veh] || 'bell';
  };

  // ---------- audio ----------
  const A = { ctx: null, buf: {}, g: {}, loops: {}, gen: null, loading: null };
  const NAMES = ['e_start1', 'e_start2', 'e_start3', 'e_aus', 'e_idle', 'e_1', 'e_2', 'e_3', 'e_4', 'e_5', 'e_n1', 'e_n2', 'e_n3', 'e_n4', 'e_n5', 'ac', 'bdo', 'bdc', 'fdo', 'fdc',
    'tag', 'hacha', 'tagless', 'bdstop', 'brkoff', 'brkon', 'squeal', 'kneeldn', 'kneelup', 'blk1', 'blk2', 'gear', 'road', 'vib', 'dryer', 'ret'];
  const RPMS = [575, 900, 1142, 1385, 1662, 1939];
  let note = '';
  const say = t => { note = t; const el = document.getElementById('busSoundNote'); if (el) el.textContent = t; };

  function setSession() { try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ } }   // same as the announcements: 'ambient' would mute them in silent mode
  function ctxUp() {      // inside a tap: browsers let a page start sound only from one
    setSession();
    if (!A.ctx) {
      A.ctx = new (window.AudioContext || window.webkitAudioContext)();
      // up to 1000%: a limiter after the master keeps the loud end from crackling
      const lim = A.ctx.createDynamicsCompressor();
      lim.threshold.value = -8; lim.knee.value = 6; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.25;
      lim.connect(A.ctx.destination);
      A.g.master = A.ctx.createGain(); A.g.master.connect(lim);
      GROUPS.slice(1).forEach(([k]) => { A.g[k] = A.ctx.createGain(); A.g[k].connect(A.g.master); });
      GROUPS.forEach(([k]) => { A.g[k].gain.value = cfg.mix[k]; });
    }
    try { A.ctx.resume(); } catch (e) { /* needs a tap */ }
    // a silent sound right now, so iPhone counts this tap as starting the sound
    try { const b = A.ctx.createBuffer(1, 1, 22050), s = A.ctx.createBufferSource(); s.buffer = b; s.connect(A.ctx.destination); s.start(); } catch (e) { /* closed */ }
  }
  async function getOne(n) {
    for (let tries = 0; ; tries++) {
      try {
        const r = await fetch(DIR + 'rs_' + n + '.wav?v=1');
        if (!r.ok) throw new Error(r.status);
        A.buf[n] = await A.ctx.decodeAudioData(await r.arrayBuffer());
        return;
      } catch (e) { if (tries >= 2) return; await new Promise(ok => setTimeout(ok, 600 * (tries + 1))); }
    }
  }
  async function loadSounds() {
    await vehReady;
    const v = V(), own = v ? [...v.loops.map(l => l.f), ...Object.values(v.one)].map(f => f.replace(/^rs_/, '')) : [];
    const missing = [...new Set([...NAMES, ...own, bellName()])].filter(n => !A.buf[n]);
    let done = 0;
    const queue = missing.slice();
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) { await getOne(queue.shift()); done++; say(`버스 소리 불러오는 중... ${Math.round(done / missing.length * 100)}%`); }
    }));
  }
  function loop(name, group, gain = 0) {
    if (!A.buf[name]) return null;
    const s = A.ctx.createBufferSource(), g = A.ctx.createGain();
    s.buffer = A.buf[name]; s.loop = true; g.gain.value = gain;
    s.connect(g); g.connect(A.g[group]); s.start(A.ctx.currentTime, Math.random() * s.buffer.duration);
    return A.loops[name] = { s, g };
  }
  function shot(name, group = 'fx', gain = 1, rate = 1) {
    if (!A.ctx || !A.buf[name] || !cfg.on) return 0;
    const s = A.ctx.createBufferSource(), g = A.ctx.createGain();
    s.buffer = A.buf[name]; s.playbackRate.value = rate; g.gain.value = gain;
    s.connect(g); g.connect(A.g[group]); s.start();
    return A.buf[name].duration / rate;
  }
  const set = (p, v, t = 0.08) => p.setTargetAtTime(v, A.ctx.currentTime, t);
  function stopLoops() {
    Object.values(A.loops).forEach(l => { try { l.g.gain.setTargetAtTime(0, A.ctx.currentTime, 0.3); l.s.stop(A.ctx.currentTime + 1.5); } catch (e) { /* stopped */ } });
    A.loops = {}; A.gen = null;
  }

  // the Hyundai: cabin recordings at 6 speeds, under load and coasting, blended by rpm
  function engine(rpm, load, on) {
    const L = A.loops;
    if (!L.e_idle) return;
    const r = Math.max(RPMS[0], Math.min(RPMS[5], rpm));
    let i = 0; while (i < 4 && r > RPMS[i + 1]) i++;
    const f = (r - RPMS[i]) / (RPMS[i + 1] - RPMS[i]);
    const w = RPMS.map((_, k) => k === i ? 1 - f : k === i + 1 ? f : 0);
    const k0 = on ? 1 : 0;
    set(L.e_idle.g.gain, k0 * w[0] * 0.9);
    L.e_idle.s.playbackRate.setTargetAtTime(Math.max(0.05, rpm / RPMS[0]), A.ctx.currentTime, 0.08);
    for (let n = 1; n <= 5; n++) {
      const rate = Math.max(0.05, rpm / RPMS[n]);
      if (L['e_' + n]) { set(L['e_' + n].g.gain, k0 * w[n] * (0.25 + 0.75 * load)); L['e_' + n].s.playbackRate.setTargetAtTime(rate, A.ctx.currentTime, 0.08); }
      if (L['e_n' + n]) { set(L['e_n' + n].g.gain, k0 * w[n] * (1 - load) * 0.75); L['e_n' + n].s.playbackRate.setTargetAtTime(rate, A.ctx.currentTime, 0.08); }
    }
  }
  // any other bus: its loops as OMSI plays them, volume curves on the bus's numbers, pitch value / reference
  const curve = (p, x) => { if (!p.length) return 1; if (x <= p[0][0]) return p[0][1]; for (let i = 1; i < p.length; i++) if (x <= p[i][0]) { const a = p[i - 1], b = p[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1); } return p[p.length - 1][1]; };
  function engineOMSI(vars, on) {
    if (!A.gen) return;
    A.gen.forEach(({ l, s, g, norm }) => {
      let gain = on || l.g === 'ac' ? l.vol * norm : 0;
      l.curves.forEach(c => { gain *= curve(c.p, vars[c.v] ?? 0); });
      let rate = l.pitch ? curve(l.pitch.p, vars[l.pitch.v] ?? 0) : (vars[l.var] ?? 0) / l.ref;
      if (rate < 0.08) { gain = 0; rate = 0.08; }
      set(g.gain, Math.max(0, gain));
      s.playbackRate.setTargetAtTime(Math.min(4, rate), A.ctx.currentTime, 0.08);
    });
  }

  // ---------- the bus ----------
  const R = { speaking: 0, run: false, engineOn: false, v: 0, rpm: 0, load: 0, gear: 1, throttle: 0, braking: false, pax: 0, timers: [], belled: {}, squealed: false, lastIdx: -1, fed: 0 };
  const later = (ms, f) => { const t = setTimeout(() => { R.timers = R.timers.filter(x => x !== t); if (R.run) f(); }, ms); R.timers.push(t); };
  const GEARS = [0, 105, 60, 39, 28];   // rpm per km/h in each gear of the automatic box
  let want = { v: 0, dist: Infinity, idx: -1 };

  function physics(dt) {
    const v = V(), ev = !!(v && v.kind === 'ev');
    if (!R.engineOn) { R.rpm = Math.max(0, R.rpm - 400 * dt); if (v) engineOMSI({}, false); else engine(R.rpm, 0, R.rpm > 100); return; }
    // speed from the simulation (km/h, its real-world speed, not the fast-forwarded one)
    const target = want.v * 3.6, prev = R.v;
    R.v += (target - R.v) * Math.min(1, dt * 6);
    const acc = (R.v - prev) / Math.max(dt, 0.001);      // km/h per second
    R.braking = acc < -0.8 && R.v > 0.3;
    R.throttle += ((acc > 0.3 ? Math.min(1, 0.35 + acc / 6) : R.v > 3 && !R.braking ? 0.25 : 0) - R.throttle) * Math.min(1, dt * 3);
    if (R.v < 9 && R.braking && !R.squealed && Math.random() < 0.02) { R.squealed = true; shot('squeal', 'fx', 0.2); }
    if (R.v > 15) R.squealed = false;
    const up = [0, 15, 27, 41][R.gear], down = [0, 0, 11, 22, 34][R.gear];
    if (ev) R.gear = 1;
    else if (R.gear < 4 && R.v > up && R.throttle > 0.1) { R.gear++; if (!v) shot('gear', 'eng', 0.2); }
    if (R.gear > 1 && R.v < down) R.gear--;
    let rpm = ev ? R.v * 5.53 * 9 : R.v * GEARS[R.gear];
    if (R.gear === 1 && !ev) rpm = Math.max(rpm, 590 + R.throttle * 700);
    if (!ev) rpm = Math.max(590, rpm);
    R.rpm += (rpm - R.rpm) * Math.min(1, dt * 4);
    R.load += ((R.braking ? 0 : R.throttle) - R.load) * Math.min(1, dt * 3);
    if (v) {
      const wheel = R.v * 5.53, retard = R.braking && R.v > 12 ? 1 : 0;
      engineOMSI({ engine_n: ev ? 592 : R.rpm, engine_nd: ev ? 592 : R.rpm, throttle: R.throttle, engine_throttle_injection: R.load, velocity: R.v, wheel_rotationspeed_1_l: wheel, wheel_rotationspeed_1_r: wheel,
        m_wheel: R.braking ? -3000 : R.load * 6000, antrieb_n_kardanwelle: wheel * 6.2, antrieb_retarder: retard, antrieb_retarder_volume: retard, cp_klimator_rpm: 77 }, true);
    } else engine(R.rpm, R.load, true);
    const L = A.loops;
    if (L.road) { set(L.road.g.gain, Math.min(1, R.v / 45) * 0.9, 0.2); L.road.s.playbackRate.setTargetAtTime(0.75 + R.v / 120, A.ctx.currentTime, 0.2); }
    if (L.vib) set(L.vib.g.gain, Math.min(1, R.v / 50) * 0.5, 0.3);
    if (L.ret) set(L.ret.g.gain, !ev && R.braking && R.v > 12 ? 0.12 : 0, 0.15);
    // the bell: like on a real bus, someone presses it once "이번 정류소는 ..." has been said (bell() after the
    // announcement); if no announcement came by 120 m before the stop, then
    if (want.idx >= 0 && !R.belled[want.idx] && want.dist < 120 && want.dist > 30 && R.v > 8 && !R.speaking) bell();
  }
  function bell() {
    const idx = want.idx;
    if (idx < 0 || R.belled[idx]) return;
    const last = typeof currentGuideStops !== 'undefined' && currentGuideStops && idx >= currentGuideStops.length - 1;
    R.belled[idx] = R.pax > 0 && (last || Math.random() < 0.7) ? 'yes' : 'no';
    if (R.belled[idx] === 'yes') shot(bellName(), 'fx', 0.9);
  }
  // a timer, not animation frames: those stop while the page is not on screen
  let lastT = 0, ticker = 0;
  function frame() {
    const t = performance.now(), dt = Math.min(0.5, (t - (lastT || t)) / 1000); lastT = t;
    if (A.ctx) physics(dt);
    if (!R.run && R.rpm <= 0) { clearInterval(ticker); ticker = 0; }
  }
  function startTicker() { lastT = 0; if (!ticker) ticker = setInterval(frame, 50); }

  async function startEngine() {
    const v = V();
    if (v) {
      let d = 1;
      if (v.one.start) d = shot(v.one.start.replace(/^rs_/, ''), 'eng', 0.9) || 1;
      const top = Math.max(...v.loops.filter(l => l.g === 'eng').map(l => l.vol), 1);
      A.gen = v.loops.filter(l => A.buf[l.f.replace(/^rs_/, '')]).map((l, k) => {
        const s = A.ctx.createBufferSource(), g = A.ctx.createGain();
        s.buffer = A.buf[l.f.replace(/^rs_/, '')]; s.loop = true; g.gain.value = 0;
        s.connect(g); g.connect(A.g[l.g]); s.start(A.ctx.currentTime, Math.random() * s.buffer.duration);
        A.loops['gen' + k] = { s, g };
        return { l, s, g, norm: l.g === 'ac' ? 1.6 : 1.4 / top };
      });
      loop('road', 'road'); loop('vib', 'road'); if (v.kind !== 'ev') loop('ret', 'eng');
      if (!v.loops.some(l => l.g === 'ac')) { const a = loop('ac', 'ac', 0); if (a) set(a.g.gain, 0.8, 1.5); }
      later(Math.max(800, d * 1000 - 600), () => { R.engineOn = true; R.rpm = v.kind === 'ev' ? 0 : 1000; R.gear = 1; startTicker(); });
      return;
    }
    shot('e_start1', 'eng', 0.9);
    later(450, () => shot('e_start2', 'eng', 0.9));
    later(850, () => {
      const d = shot('e_start3', 'eng', 0.9) || 1.5;
      NAMES.filter(n => /^e_(idle|n?\d)$/.test(n)).forEach(n => loop(n, 'eng'));
      loop('road', 'road'); loop('vib', 'road'); loop('ret', 'eng');
      later(Math.max(300, d * 1000 - 900), () => { R.engineOn = true; R.rpm = 1100; R.gear = 1; startTicker(); });
      later(Math.max(300, d * 1000 + 600), () => { const a = loop('ac', 'ac', 0); if (a) set(a.g.gain, 0.8, 1.5); });
    });
  }

  const busSound = {
    // the simulation button was tapped: get the sound going (this must happen inside the tap)
    prime() {
      if (!cfg.on) return;
      this.stop(true);
      ctxUp();
      R.run = true; R.speaking = 0; R.pax = Math.round(rnd(3, 12)); R.belled = {}; R.v = 0; want = { v: 0, dist: Infinity, idx: -1 };
      say('버스 소리 불러오는 중...');
      A.loading = loadSounds().then(() => {
        if (!R.run) return;
        say('시동 거는 중...'); startEngine();
        later(4000, () => say(''));
      });
    },
    // every simulation step: the bus's real-world speed (m/s), metres to the next stop, that stop's index
    feed(mps, dist, idx) { if (R.run) want = { v: Math.max(0, mps || 0), dist: dist ?? Infinity, idx: idx ?? -1 }; },
    // arrived at a stop: plays the stop (brake, doors, people getting off and on, doors shut, off again)
    // and says how long the bus stands there in ms (0: sound off, the simulation keeps its own time)
    arrive(mult, last, idx, wait0 = 0) {
      if (!R.run || !cfg.on || !A.ctx) return 0;
      want = { v: 0, dist: 0, idx: -1 };
      const s = Math.min(1, 1 / Math.max(0.25, mult || 1));      // fast-forward: the same stop, quicker
      const belled = R.belled[idx] === 'yes';
      const hy = !V();
      let t = wait0; const at = (ms, f) => later(t + ms * s, f);
      at(0, () => shot(S('brkon'), 'fx', 0.7)); t += 700 * s;
      const kneel = Math.random() < 0.3;
      if (kneel) at(0, () => shot('kneeldn', 'fx', 0.3));
      at(0, () => shot(S('fdo'), 'fx', 0.8));
      const off = last ? R.pax : belled ? Math.max(1, Math.min(R.pax, Math.round(rnd(1, 6)))) : 0;
      const on = last ? 0 : Math.round(rnd(0, 6));
      if (off) at(250, () => shot(S('bdo'), 'fx', 0.75));
      t += 1750 * s;
      if (Math.random() < 0.3) at(0, () => shot('dryer', 'fx', 0.2));
      let ta = 0; for (let n = 0; n < off; n++) { ta += rnd(700, 1700); at(ta, () => { shot('hacha', 'fx', 0.9); R.pax = Math.max(0, R.pax - 1); }); }
      let tb = rnd(600, 1400); for (let n = 0; n < on; n++) { at(tb, () => { shot(cfg.tagless && Math.random() < 0.2 ? 'tagless' : 'tag', 'fx', 0.9); R.pax++; }); tb += rnd(900, 2200); }
      t += (Math.max(ta, tb) + rnd(1500, 3500)) * s;
      if (last) { say('종점입니다'); return t; }
      if (off) {
        if (hy) { at(0, () => shot('bdstop', 'fx', 0.6)); t += 900 * s; }
        at(0, () => shot(S('bdc'), 'fx', 0.75));
      }
      at(0, () => shot(S('fdc'), 'fx', 0.8)); t += 3200 * s;
      if (kneel) { at(0, () => shot('kneelup', 'fx', 0.3)); t += 1500 * s; }
      at(0, () => shot(S('brkoff'), 'fx', 0.8));
      for (let n = 0; n < 7; n++) at(n * 400, () => shot(n % 2 ? 'blk2' : 'blk1', 'fx', 0.25));
      t += 900 * s;
      return t;
    },
    // the first stop: wait for the engine, then take people on before pulling away
    depart(mult, idx) {
      if (!R.run || !cfg.on || !A.ctx) return 0;
      return this.arrive(mult, false, idx, R.engineOn ? 0 : 4000);
    },
    stop(quiet) {
      const wasOn = R.engineOn;
      R.run = false; R.timers.forEach(clearTimeout); R.timers = [];
      if (A.ctx && wasOn && !quiet) { const v = V(); if (!v) shot('e_aus', 'eng', 0.9); else if (v.one.stop) shot(v.one.stop.replace(/^rs_/, ''), 'eng', 0.9); }
      R.engineOn = false; R.v = 0;
      if (A.ctx) stopLoops();
      clearInterval(ticker); ticker = 0; R.rpm = 0;
      say('');
    }
  };
  // the site's announcement starts/ends: the bus goes quieter under it (a real bus's speakers are above the engine),
  // and after the next stop's announcement while driving, a passenger rings the bell
  busSound.voice = on => {
    R.speaking = Math.max(0, R.speaking + (on ? 1 : -1));
    // only the engine, AC and road go quieter: the bell, doors, card taps and 하차 sounds stay full
    ['eng', 'ac', 'road'].forEach(k => { if (A.g[k]) A.g[k].gain.setTargetAtTime(cfg.mix[k] * (R.speaking ? 0.35 : 1), A.ctx.currentTime, R.speaking ? 0.08 : 0.6); });
    if (!on && !R.speaking && R.run && R.v > 8 && want.idx >= 0 && want.dist > 60 && !R.belled[want.idx]) {
      const idx = want.idx;
      later(rnd(1200, 4000), () => { if (want.idx === idx && !R.speaking) bell(); });
    }
  };
  busSound.state = () => ({ run: R.run, engineOn: R.engineOn, kmh: Math.round(R.v), rpm: Math.round(R.rpm), gear: R.gear, load: +R.load.toFixed(2), pax: R.pax, loops: Object.keys(A.loops).length, buffers: Object.keys(A.buf).length, ctx: A.ctx && A.ctx.state, timers: R.timers.length });
  window.busSound = busSound;

  // back from another app: phones leave the sound interrupted
  const wake = () => { if (R.run && A.ctx && A.ctx.state !== 'running') { setSession(); A.ctx.resume().catch(() => {}); } };
  ['visibilitychange', 'pageshow', 'focus'].forEach(ev => (ev === 'visibilitychange' ? document : window).addEventListener(ev, () => { if (document.visibilityState === 'visible') { wake(); setTimeout(wake, 700); } }));
  ['touchend', 'click'].forEach(ev => document.addEventListener(ev, wake, true));

  // ---------- the settings, in the simulation's 속도/음량/전광판 설정 ----------
  const style = document.createElement('style');
  style.textContent = `
    .guide-options{max-height:2400px}
    .bus-sound{margin:6px 0 10px;padding:10px;border:1px solid var(--line,#333);border-radius:10px;background:rgba(127,127,127,.06)}
    .bus-sound h4{margin:0 0 8px;font-size:13px}
    .bus-sound .row{display:flex;align-items:center;gap:8px;margin:6px 0;font-size:12px}
    .bus-sound label.row{flex-direction:row;cursor:pointer}
    .bus-sound .row input[type=checkbox]{width:18px!important;height:18px!important;min-width:0;flex:none;margin:0;padding:0;accent-color:#ff5a36}
    .bus-sound .row span{flex:1;text-align:left}
    .bus-sound .row b{flex:none;min-width:58px}
    .bus-sound select{flex:1;min-width:0;padding:5px 6px;border-radius:7px;font:inherit}
    .bus-sound .mix{display:grid;grid-template-columns:auto 1fr 3.2em;gap:4px 8px;align-items:center;font-size:12px;margin-top:6px}
    .bus-sound .mix input{width:100%}
    .bus-sound .note{font-size:11px;color:var(--muted,#999);min-height:1em}
  `;
  document.head.appendChild(style);

  function panel() {
    const vehOpts = [['hyundai', '현대 뉴슈퍼에어로시티 (CNG)'], ...Object.entries(VEH).map(([k, v]) => [k, v.name])];
    const bellOpts = [['auto', '차량에 맞춤'], ...FIXED_BELLS, ...Object.values(VEH).filter(v => v.one.bell).map(v => [v.one.bell.replace(/^rs_/, ''), v.name.replace(/ \(.*\)$/, '') + ' 벨'])];
    const opt = (list, cur) => list.map(([k, n]) => `<option value="${esc(k)}"${k === cur ? ' selected' : ''}>${esc(n)}</option>`).join('');
    return `<div class="bus-sound" id="busSoundBox">
      <h4>🚌 버스 소리 (실제 버스처럼)</h4>
      <label class="row"><input type="checkbox" id="bsOn"${cfg.on ? ' checked' : ''}> <span>시뮬레이션에 엔진·에어컨·문·카드·하차벨 소리 넣기</span></label>
      <div class="row"><b>차량</b><select id="bsVeh">${opt(vehOpts, cfg.veh)}</select></div>
      <div class="row"><b>하차벨</b><select id="bsBell">${opt(bellOpts, cfg.bell)}</select><button type="button" class="guide-btn ghost" id="bsBellTry">▶ 듣기</button></div>
      <label class="row"><input type="checkbox" id="bsTagless"${cfg.tagless ? ' checked' : ''}> <span>태그리스 (타는 손님 5명 중 1명쯤)</span></label>
      <div class="mix">${GROUPS.map(([k, n]) => `<span>${n}</span><input type="range" min="0" max="1000" step="10" value="${Math.round(cfg.mix[k] * 100)}" data-k="${k}"><span id="bsV_${k}">${Math.round(cfg.mix[k] * 100)}%</span>`).join('')}</div>
      <div class="note" id="busSoundNote">${esc(note)}</div>
    </div>`;
  }
  function wire() {
    const $ = id => document.getElementById(id);
    if (!$('busSoundBox')) return;
    $('bsOn').onchange = () => { cfg.on = $('bsOn').checked; save(); if (!cfg.on) busSound.stop(true); };
    $('bsVeh').onchange = () => { cfg.veh = $('bsVeh').value; save(); if (R.run) say('차량은 다음 시뮬레이션부터 바뀝니다'); };
    $('bsBell').onchange = () => { cfg.bell = $('bsBell').value; save(); };
    $('bsTagless').onchange = () => { cfg.tagless = $('bsTagless').checked; save(); };
    $('bsBellTry').onclick = async () => {
      ctxUp(); await vehReady;
      if (!A.buf[bellName()]) { say('불러오는 중...'); await getOne(bellName()); say(''); }
      const was = cfg.on; cfg.on = true; shot(bellName(), 'fx', 0.9); cfg.on = was;
    };
    document.querySelectorAll('#busSoundBox .mix input').forEach(r => {
      r.oninput = () => {
        const k = r.dataset.k; cfg.mix[k] = r.value / 100; $('bsV_' + k).textContent = r.value + '%'; save();
        if (A.g[k]) A.g[k].gain.setTargetAtTime(cfg.mix[k] * (['eng', 'ac', 'road'].includes(k) && R.speaking ? 0.35 : 1), A.ctx.currentTime, 0.05);
      };
    });
  }
  function inject() {
    const box = document.getElementById('guideOptions');
    if (!box || document.getElementById('busSoundBox')) return;
    box.insertAdjacentHTML('afterbegin', panel());
    wire();
  }
  try {
    const baseRender = renderGuideBar;
    renderGuideBar = function () { const r = baseRender.apply(this, arguments); try { inject(); } catch (e) { console.error('bus sound panel', e); } return r; };
    vehReady.then(() => { const b = document.getElementById('busSoundBox'); if (b) { b.remove(); inject(); } });
    inject();
  } catch (e) { console.error('bus sound: no guide bar', e); }
})();
