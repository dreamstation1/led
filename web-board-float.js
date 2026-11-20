// 인터넷 전광판: the real sign (ledcode.ino) drawn in the browser (board/web-board.html, from BusLive's ride.html), as a
// small window floating over the map: drag it by the bar, size it from the corner, 핀 floats it above every other window
// (games included) where the browser has Document Picture-in-Picture, else in its own popup window. The map page talks to
// it with the sign's own commands over the BroadcastChannel 'led-web-board' (index.html, ledMode 'web').
(function () {
  const KEY = 'ledWebBoardFloat', MIN_W = 200, MIN_H = 74, BAR = 26, SRC = 'board/web-board.html?v=2';
  let box = null, frame = null, pip = null, pop = null;
  let at = { x: 140, y: 64, w: 400, h: 100 + BAR };
  try { at = Object.assign(at, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { /* the default place */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ x: at.x, y: at.y, w: at.w, h: at.h })); } catch (e) { /* this visit */ } };

  const css = document.createElement('style');
  css.textContent = `
#ledwebfloat { position: fixed; z-index: 99999; display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden;
  background: #000; border: 1px solid #3a4452; border-radius: 8px; box-shadow: 0 6px 24px rgba(0, 0, 0, .45); }
#ledwebfloat .bar { flex: none; display: flex; align-items: center; gap: 4px; height: ${BAR}px; padding: 0 4px 0 10px; box-sizing: border-box;
  background: #1c222b; color: #e8edf3; font: 12px "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif; cursor: move; touch-action: none; user-select: none; }
#ledwebfloat .bar span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#ledwebfloat .bar button { flex: none; height: 20px; padding: 0 8px; border: 0; border-radius: 5px; background: #2c343f; color: inherit; font: inherit; cursor: pointer; }
#ledwebfloat .bar button:hover { background: #3a4452; }
#ledwebfloat iframe { flex: 1; min-height: 0; width: 100%; border: 0; display: block; }
#ledwebfloat .grip { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; touch-action: none;
  background: linear-gradient(135deg, transparent 55%, #7b8794 55%, #7b8794 65%, transparent 65%, transparent 75%, #7b8794 75%, #7b8794 85%, transparent 85%); }
#ledwebfloat.busy iframe { pointer-events: none; }`;
  document.head.appendChild(css);

  function place() {
    if (!box || !innerWidth || !innerHeight) return;
    const w = Math.max(MIN_W, Math.min(at.w, innerWidth)), h = Math.max(MIN_H, Math.min(at.h, innerHeight));
    box.style.left = Math.max(0, Math.min(at.x, innerWidth - w)) + 'px';
    box.style.top = Math.max(0, Math.min(at.y, innerHeight - h)) + 'px';
    box.style.width = w + 'px'; box.style.height = h + 'px';
  }

  function follow(el, move) {
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const start = { px: e.clientX, py: e.clientY, x: at.x, y: at.y, w: at.w, h: at.h };
      el.setPointerCapture(e.pointerId);
      box.classList.add('busy');
      const step = m => { move(start, m.clientX - start.px, m.clientY - start.py); place(); };
      const end = () => {
        box.classList.remove('busy');
        at.x = box.offsetLeft; at.y = box.offsetTop; at.w = box.offsetWidth; at.h = box.offsetHeight;
        el.removeEventListener('pointermove', step);
        el.removeEventListener('pointerup', end);
        el.removeEventListener('pointercancel', end);
        save();
      };
      el.addEventListener('pointermove', step);
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
    });
  }

  function build() {
    box = document.createElement('div');
    box.id = 'ledwebfloat';
    box.innerHTML = '<div class="bar"><span>인터넷 전광판</span><button class="pin" title="다른 창과 게임 위에 항상 띄우기">핀</button><button class="shut" title="닫기">닫기</button></div><iframe title="인터넷 전광판"></iframe><div class="grip"></div>';
    frame = box.querySelector('iframe');
    frame.src = SRC;
    document.body.appendChild(box);
    follow(box.querySelector('.bar'), (s, dx, dy) => { at.x = s.x + dx; at.y = s.y + dy; });
    follow(box.querySelector('.grip'), (s, dx, dy) => { at.w = s.w + dx; at.h = s.h + dy; });
    box.querySelector('.shut').onclick = close;
    box.querySelector('.pin').onclick = pinUp;
    box.addEventListener('pointerup', () => frame && frame.contentWindow && frame.contentWindow.focus());   // keys go to the board: 4444 and Enter
    place();
  }

  function hideBox() { if (box) { box.remove(); box = null; frame = null; } }

  // no Document Picture-in-Picture (Safari, Firefox, older Chromium): the board in its own small window instead
  function pinPopup() {
    pop = window.open(SRC, 'ledWebBoard', `popup=yes,width=${Math.round(at.w)},height=${Math.round(at.h - BAR)}`);
    if (pop) hideBox();
    else if (box) box.querySelector('.bar span').textContent = '팝업이 막혔어요 - 이 사이트 팝업을 허용해 주세요';
  }

  async function pinUp() {
    if (!window.documentPictureInPicture) return pinPopup();
    try {
      pip = await documentPictureInPicture.requestWindow({ width: Math.round(at.w), height: Math.round(at.h - BAR) });
    } catch (e) {
      return pinPopup();
    }
    pip.document.title = '인터넷 전광판';
    pip.document.body.style.cssText = 'margin:0;height:100vh;background:#000;overflow:hidden';
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
