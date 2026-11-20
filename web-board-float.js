// 인터넷 전광판: the real sign (ledcode.ino) drawn in the browser (board/web-board.html, from BusLive's ride.html), as a
// small window floating over the map. Only the sign shows: the window keeps the sign's shape (frame + 128x32 board), it
// moves when dragged anywhere and sizes from the corner, and 핀 / 닫기 appear only while the pointer is over it (or after a
// tap). 핀 floats it above every other window (games included) where the browser has Document Picture-in-Picture, else in
// its own popup window. The map page talks to it with the sign's own commands over the BroadcastChannel 'led-web-board'.
(function () {
  const KEY = 'ledWebBoardFloat', MIN_W = 220, SRC = 'board/web-board.html?v=5';
  let box = null, frame = null, pip = null, pop = null, shownTimer = 0;
  let at = { x: 140, y: 64, w: 420 };
  try { at = Object.assign(at, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* the default place */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ x: at.x, y: at.y, w: at.w })); } catch (e) { /* this visit */ } };
  // the height that fits the sign exactly at this width (same frame as web-board.html: 2.2% of the width, at least 5 px)
  const signH = w => { const p = Math.max(5, Math.round(w * 0.022)); return Math.round((w - 2 * p - 4) / 4 + 2 * p + 4); };

  const css = document.createElement('style');
  css.textContent = `
#ledwebfloat { position: fixed; z-index: 99999; box-sizing: border-box; overflow: hidden; background: #1d1f23;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .45); touch-action: none; }
#ledwebfloat iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; display: block; pointer-events: none; }
#ledwebfloat .drag { position: absolute; inset: 0; cursor: move; }
#ledwebfloat .tools { position: absolute; top: 4px; right: 4px; display: flex; gap: 4px; opacity: 0; transition: opacity .15s; }
#ledwebfloat:hover .tools, #ledwebfloat.show .tools { opacity: 1; }
#ledwebfloat .tools button { height: 22px; padding: 0 9px; border: 0; border-radius: 5px; background: rgba(28, 34, 43, .92); color: #e8edf3;
  font: 12px "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif; cursor: pointer; }
#ledwebfloat .tools button:hover { background: #3a4452; }
#ledwebfloat .grip { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; opacity: 0; transition: opacity .15s;
  background: linear-gradient(135deg, transparent 55%, #7b8794 55%, #7b8794 65%, transparent 65%, transparent 75%, #7b8794 75%, #7b8794 85%, transparent 85%); }
#ledwebfloat:hover .grip, #ledwebfloat.show .grip { opacity: 1; }`;
  document.head.appendChild(css);

  function place() {
    if (!box || !innerWidth || !innerHeight) return;
    const w = Math.round(Math.max(MIN_W, Math.min(at.w, innerWidth, innerHeight * 4))), h = signH(w);
    box.style.left = Math.max(0, Math.min(at.x, innerWidth - w)) + 'px';
    box.style.top = Math.max(0, Math.min(at.y, innerHeight - h)) + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
  }

  function showTools() {             // a tap (no hover on phones) shows 핀 / 닫기 for a few seconds
    if (!box) return;
    box.classList.add('show');
    clearTimeout(shownTimer);
    shownTimer = setTimeout(() => box && box.classList.remove('show'), 3000);
  }

  function follow(el, move) {
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      showTools();
      const start = { px: e.clientX, py: e.clientY, x: at.x, y: at.y, w: at.w };
      el.setPointerCapture(e.pointerId);
      const step = m => { move(start, m.clientX - start.px, m.clientY - start.py); place(); };
      const end = () => {
        at.x = box.offsetLeft; at.y = box.offsetTop; at.w = box.offsetWidth;
        el.removeEventListener('pointermove', step);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
        save();
        if (frame && frame.contentWindow) frame.contentWindow.focus();     // keys go to the board: 4444 and Enter
      };
      el.addEventListener('pointermove', step);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }

  function build() {
    box = document.createElement('div');
    box.id = 'ledwebfloat';
    box.innerHTML = '<iframe title="인터넷 전광판"></iframe><div class="drag" title="끌어서 옮기기"></div>'
      + '<div class="tools"><button class="pin" title="다른 창과 게임 위에 항상 띄우기">핀</button><button class="shut" title="닫기">닫기</button></div>'
      + '<div class="grip" title="크기 바꾸기"></div>';
    frame = box.querySelector('iframe');
    frame.src = SRC;
    document.body.appendChild(box);
    follow(box.querySelector('.drag'), (s, dx, dy) => { at.x = s.x + dx; at.y = s.y + dy; });
    follow(box.querySelector('.grip'), (s, dx, dy) => { at.w = s.w + Math.max(dx, dy * 4); });
    box.querySelector('.shut').onclick = close;
    box.querySelector('.pin').onclick = pinUp;
    place();
  }

  function hideBox() { if (box) { box.remove(); box = null; frame = null; } }

  function pinSize() { const w = Math.round(Math.max(MIN_W, at.w)); return { w, h: signH(w) }; }

  // no Document Picture-in-Picture (Safari, Firefox, older Chromium): the board in its own small window instead
  function pinPopup() {
    const s = pinSize();
    pop = window.open(SRC, 'ledWebBoard', `popup=yes,width=${s.w},height=${s.h}`);
    if (pop) hideBox();
  }

  async function pinUp() {
    if (!window.documentPictureInPicture) return pinPopup();
    const s = pinSize();
    try {
      pip = await documentPictureInPicture.requestWindow({ width: s.w, height: s.h });
    } catch (e) {
      return pinPopup();
    }
    pip.document.title = '인터넷 전광판';
    pip.document.body.style.cssText = 'margin:0;height:100vh;background:#1d1f23;overflow:hidden';
    const f = pip.document.createElement('iframe');
    f.src = new URL(SRC, location.href).href;
    f.title = '인터넷 전광판';
    f.style.cssText = 'border:0;display:block;width:100%;height:100%';
    pip.document.body.appendChild(f);
    hideBox();
    pip.addEventListener('pagehide', () => {       // the pinned window was closed: back onto the map while still connected
      pip = null;
      if (window.ledWebBoardWanted && window.ledWebBoardWanted()) open();
    });
  }

  function isOpen() { return !!(box || pip || (pop && !pop.closed)); }
  function open() {
    if (pip || (pop && !pop.closed)) { try { (pop || pip).focus(); } catch (e) { /* nothing */ } return; }
    if (!box) build();
  }
  function close() {
    hideBox();
    if (pip) { const p = pip; pip = null; p.close(); }
    if (pop && !pop.closed) pop.close();
    pop = null;
  }

  window.ledWebBoard = { open, close, isOpen };
  addEventListener('resize', place);
})();
