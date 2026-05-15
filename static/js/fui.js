/* ============================================================
   fui.js — O.R.I.S. FUI Engine
   ============================================================ */

/* global socketClient */

const FUI = (() => {

  // ── STATE ──────────────────────────────────────────────────
  let _particles    = [];
  let _ctx          = null;
  let _raf          = null;
  let _insightCount = 0;
  let _txSegCount   = 0;
  let _txWordCount  = 0;
  let _streamingId  = null;

  // ── BOOT ───────────────────────────────────────────────────
  const BOOT_LINES = [
    'Initialising neural interface…',
    'Loading knowledge vectors…',
    'Authenticating credentials…',
    'Establishing uplink…',
    'Calibrating insight engine…',
    'ORIS READY',
  ];

  async function runBoot(overlayId, fillId, msgId, lines) {
    const ov   = document.getElementById(overlayId || 'loadOv');
    const fill = document.getElementById(fillId    || 'bootFill');
    const msg  = document.getElementById(msgId     || 'loadMsg');
    const seq  = lines || BOOT_LINES;

    if (!ov) return;

    for (let i = 0; i < seq.length; i++) {
      const pct = Math.round(((i + 1) / seq.length) * 100);
      if (msg)  msg.textContent = seq[i];
      if (fill) fill.style.width = pct + '%';
      await sleep(240 + Math.random() * 160);
    }

    await sleep(300);
    ov.classList.add('fade-out');
    await sleep(800);
    ov.classList.add('hidden');
    animateCorners();
  }

  function animateCorners() {
    document.querySelectorAll('.hud-corner').forEach((el, i) => {
      setTimeout(() => el.classList.add('ready'), i * 120);
    });
  }

  // ── PARTICLES ──────────────────────────────────────────────
  function initParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;

    _ctx = canvas.getContext('2d');

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    _particles = [];
    for (let i = 0; i < 55; i++) {
      _particles.push(mkParticle(canvas));
    }
    renderParticles(canvas);
  }

  function mkParticle(c) {
    return {
      x:  Math.random() * c.width,
      y:  Math.random() * c.height,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      r:  Math.random() * 1.2 + 0.3,
      a:  Math.random() * 0.4 + 0.05,
    };
  }

  function renderParticles(c) {
    if (!_ctx) return;
    _ctx.clearRect(0, 0, c.width, c.height);

    for (const p of _particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = c.width;
      if (p.x > c.width)  p.x = 0;
      if (p.y < 0) p.y = c.height;
      if (p.y > c.height) p.y = 0;

      _ctx.beginPath();
      _ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      _ctx.fillStyle = `rgba(0,217,255,${p.a})`;
      _ctx.fill();
    }

    for (let i = 0; i < _particles.length; i++) {
      for (let j = i + 1; j < _particles.length; j++) {
        const dx   = _particles[i].x - _particles[j].x;
        const dy   = _particles[i].y - _particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 110) {
          _ctx.beginPath();
          _ctx.moveTo(_particles[i].x, _particles[i].y);
          _ctx.lineTo(_particles[j].x, _particles[j].y);
          _ctx.strokeStyle =
            `rgba(0,217,255,${0.06 * (1 - dist / 110)})`;
          _ctx.lineWidth = 0.5;
          _ctx.stroke();
        }
      }
    }

    _raf = requestAnimationFrame(() => renderParticles(c));
  }

  // ── RADAR PING ─────────────────────────────────────────────
  function radarPing() {
    const el = document.getElementById('radarPing');
    if (!el) return;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 1500);
  }

  // ── STATUS DOTS ────────────────────────────────────────────
  function setStatus(id, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = 'sdot' + (state ? ' ' + state : '');

    // Mirror to HUD strip
    const map = { llmDot: 'hssLlm', sockDot: 'hssSock',
                  recDot: 'hssRec' };
    const hssId = map[id];
    if (hssId) {
      const hss = document.getElementById(hssId);
      if (hss) {
        hss.className = 'hss-dot' +
          (state === 'online' ? ' online' :
           state === 'error'  ? ' error'  : '');
      }
    }
  }

  function setInsightStatus(active) {
    const el = document.getElementById('hssInsight');
    if (el) el.className = 'hss-dot' + (active ? ' active' : '');
    setTickerVal('tkInsights', active ? 'ACTIVE' : 'MONITORING');
  }

  function setTickerVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── TRANSCRIPT (STUDENT) ───────────────────────────────────
  function showTranscriptPanel(sessionId) {
    const wrap = document.getElementById('sessActiveWrap');
    const list = document.getElementById('sessListSt');
    const idEl = document.getElementById('txSessionId');

    if (wrap)  wrap.classList.remove('hidden');
    if (list)  list.style.display = 'none';
    if (idEl)  idEl.textContent   = sessionId || '—';

    const pulse = document.getElementById('navLivePulse');
    if (pulse) pulse.classList.remove('hidden');

    setTickerVal('tkSess', 'LIVE');
  }

  function hideTranscriptPanel() {
    const wrap = document.getElementById('sessActiveWrap');
    const list = document.getElementById('sessListSt');
    if (wrap) wrap.classList.add('hidden');
    if (list) list.style.display = '';

    const pulse = document.getElementById('navLivePulse');
    if (pulse) pulse.classList.add('hidden');

    setTickerVal('tkSess', 'OFFLINE');
    _txSegCount = 0; _txWordCount = 0; _insightCount = 0;
  }

  function appendTranscriptInterim(text) {
    const el      = document.getElementById('txInterim');
    const waiting = document.getElementById('txWaiting');
    if (!el) return;
    if (waiting) waiting.style.display = 'none';
    el.classList.remove('hidden');
    el.textContent = text;
  }

  function appendTranscriptFinal(text, confidence) {
    confidence = confidence || 1.0;
    const content = document.getElementById('txContent');
    const interim = document.getElementById('txInterim');
    const waiting = document.getElementById('txWaiting');
    const wordEl  = document.getElementById('txWordCount');
    const segsEl  = document.getElementById('txSegs');
    const confEl  = document.getElementById('txConf');
    const scroll  = document.getElementById('txScroll');

    if (!content) return;
    if (waiting) waiting.style.display = 'none';
    if (interim) {
      interim.classList.add('hidden');
      interim.textContent = '';
    }

    _txSegCount++;
    _txWordCount += text.split(/\s+/).filter(Boolean).length;

    if (wordEl) wordEl.textContent = _txWordCount + ' WORDS';
    if (segsEl) segsEl.textContent = _txSegCount;
    if (confEl) confEl.textContent =
      Math.round(confidence * 100) + '%';

    const confPct   = Math.round(confidence * 100);
    const confColor = confPct > 85 ? 'var(--green)'
      : confPct > 65 ? 'var(--yellow)' : 'var(--red)';

    const seg = document.createElement('div');
    seg.className = 'tx-seg';
    seg.innerHTML = `
      <div class="tx-seg-text">${escHtml(text)}</div>
      <div class="tx-seg-meta">
        <div class="tx-conf-bar"
             style="width:${confPct}px;background:${confColor}">
        </div>
        <span>${confPct}% · ${timestamp()}</span>
      </div>`;

    content.appendChild(seg);
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function clearTranscript() {
    const els = ['txContent', 'txInterim', 'txWaiting',
                 'txWordCount', 'txSegs'];
    const content = document.getElementById('txContent');
    const interim = document.getElementById('txInterim');
    const waiting = document.getElementById('txWaiting');
    const word    = document.getElementById('txWordCount');
    const segs    = document.getElementById('txSegs');

    if (content) content.innerHTML = '';
    if (interim) { interim.classList.add('hidden');
                   interim.textContent = ''; }
    if (waiting) waiting.style.display = '';
    if (word)    word.textContent = '0 WORDS';
    if (segs)    segs.textContent = '0';
    _txSegCount = 0; _txWordCount = 0;
  }

  // ── INSIGHT (STUDENT) ──────────────────────────────────────
  function startInsightStream(insightId) {
    const content = document.getElementById('insightContent');
    const waiting = document.getElementById('insightWaiting');
    const scroll  = document.getElementById('insightScroll');
    const countEl = document.getElementById('insightCount');

    if (!content) return;
    if (waiting) waiting.style.display = 'none';

    _insightCount++;
    if (countEl) countEl.textContent = _insightCount + ' INSIGHTS';

    radarPing();
    setInsightStatus(true);

    const card = document.createElement('div');
    card.className = 'insight-card';
    card.id = 'insight-' + insightId;
    card.innerHTML = `
       <div class="insight-card-header">
         <span class="insight-card-label"><span class="icon-graduation"></span> STUDENT INSIGHT</span>
         <span class="insight-card-time">${timestamp()}</span>
       </div>
      <div class="insight-card-text streaming"
           id="ict-${insightId}"></div>`;

    content.appendChild(card);
    _streamingId = insightId;
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function appendInsightChunk(insightId, chunk) {
    const el = document.getElementById('ict-' + insightId);
    if (!el) return;
    el.textContent += chunk;
    const scroll = document.getElementById('insightScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  function finaliseInsight(insightId) {
    const el = document.getElementById('ict-' + insightId);
    if (el) el.classList.remove('streaming');
    _streamingId = null;
    setInsightStatus(false);
    const statusEl = document.getElementById('insightStatus');
    if (statusEl) statusEl.textContent = 'MONITORING';
  }

  // ── SOCKET → FUI WIRING ────────────────────────────────────
  function wireSocketToFUI() {
    if (typeof socketClient === 'undefined') return;

    socketClient.on('transcript:interim', (p) => {
      appendTranscriptInterim(p.text || '');
    });
    socketClient.on('transcript:final', (p) => {
      appendTranscriptFinal(p.text || '', p.confidence || 1.0);
    });
    socketClient.on('insight:student:chunk', (p) => {
      const { insight_id, chunk } = p;
      if (_streamingId !== insight_id) startInsightStream(insight_id);
      appendInsightChunk(insight_id, chunk);
    });
    socketClient.on('insight:student:done', (p) => {
      finaliseInsight(p.insight_id);
    });
    socketClient.on('session:state', (p) => {
      const el = document.getElementById('shStat');
      if (el && p.state) el.textContent = p.state.toUpperCase();
    });
    socketClient.on('socket_connected', () => {
      setStatus('sockDot', 'online');
      setTickerVal('tkUplink', 'CONNECTED');
    });
    socketClient.on('socket_disconnected', () => {
      setStatus('sockDot', 'error');
      setTickerVal('tkUplink', 'OFFLINE');
    });
    socketClient.on('socket_error', () => {
      setStatus('sockDot', 'error');
    });
  }

  // ── NAV ────────────────────────────────────────────────────
  function activatePage(pageId) {
    document.querySelectorAll('.pg').forEach(p => {
      p.classList.remove('active');
    });
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.remove('active');
    });

    const pg = document.getElementById('pg-' + pageId);
    if (pg) pg.classList.add('active');

    const nav = document.querySelector(`[data-page="${pageId}"]`);
    if (nav) nav.classList.add('active');

    const bc = document.getElementById('bcPage');
    if (bc) bc.textContent =
      pageId.charAt(0).toUpperCase() + pageId.slice(1);
  }

  // ── SIDEBAR ────────────────────────────────────────────────
  function toggleSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sbOverlay');
    if (!sb) return;
    const open = sb.classList.toggle('open');
    if (ov) ov.style.display = open ? 'block' : 'none';
  }

  function closeSidebar() {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sbOverlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.style.display = 'none';
  }

  // ── TOAST ──────────────────────────────────────────────────
  function toast(message, type, duration) {
    type     = type     || 'inf';
    duration = duration || 4000;
    const cont = document.getElementById('toastCont');
    if (!cont) return;

    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.innerHTML =
      `<span style="font-family:var(--fd);font-size:.62rem;
                    letter-spacing:.1em">
         ${type === 'ok' ? '✓' : type === 'err' ? '✕' : '◈'}
       </span>
       ${escHtml(message)}`;

    cont.appendChild(t);
    t.style.cssText =
      'opacity:0;transform:translateX(20px);' +
      'transition:all 0.3s ease';

    requestAnimationFrame(() => {
      t.style.opacity   = '1';
      t.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
      t.style.opacity   = '0';
      t.style.transform = 'translateX(20px)';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  // ── CHAT BUBBLES ───────────────────────────────────────────
  function appendMessage(role, content, meta) {
    const msgs = document.getElementById('chatMsgs');
    if (!msgs) return null;

    const isUser = role === 'user';
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    div.innerHTML = `
      <div class="msg-av">${isUser ? 'YOU' : 'AI'}</div>
      <div class="msg-content">
        <div class="msg-bub">${escHtml(content)}</div>
        ${meta ? `<div class="msg-meta">${escHtml(meta)}</div>` : ''}
      </div>`;

    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function appendStreamMessage() {
    const msgs = document.getElementById('chatMsgs');
    if (!msgs) return null;

    const div    = document.createElement('div');
    div.className = 'msg ai';

    const textEl = document.createElement('div');
    textEl.className = 'msg-bub streaming';

    const av      = document.createElement('div');
    av.className  = 'msg-av';
    av.textContent = 'AI';

    const content = document.createElement('div');
    content.className = 'msg-content';
    content.appendChild(textEl);

    div.appendChild(av);
    div.appendChild(content);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return textEl;
  }

  function appendStreamChunk(el, chunk) {
    if (!el) return;
    el.textContent += chunk;
    const msgs = document.getElementById('chatMsgs');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  function finaliseStreamMessage(el, meta) {
    if (!el) return;
    el.classList.remove('streaming');
    if (meta) {
      const m = document.createElement('div');
      m.className   = 'msg-meta';
      m.textContent = meta;
      el.parentNode.appendChild(m);
    }
  }

  // ── SCORE RING ─────────────────────────────────────────────
  function animateScoreRing(pct) {
    const circle = document.getElementById('qrFillCircle');
    if (!circle) return;
    const offset = 264 - (pct / 100) * 264;
    requestAnimationFrame(() => {
      circle.style.strokeDashoffset = offset;
    });

    const scoreEl = document.getElementById('qScoreVal');
    if (!scoreEl) return;
    let cur  = 0;
    const step = pct / 40;
    const iv = setInterval(() => {
      cur = Math.min(cur + step, pct);
      scoreEl.textContent = Math.round(cur) + '%';
      if (cur >= pct) clearInterval(iv);
    }, 25);
  }

  // ── STAT BAR ───────────────────────────────────────────────
  function animateStatBar(id, pct) {
    const el = document.getElementById(id);
    if (!el) return;
    setTimeout(() => { el.style.width = pct + '%'; }, 100);
  }

  // ── HELPERS ────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function timestamp() {
    return new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── INIT ───────────────────────────────────────────────────
  function init() {
    initParticles();
    runBoot();
  }

  // ── PUBLIC ─────────────────────────────────────────────────
  return {
    init, runBoot, animateCorners, radarPing,
    setStatus, setInsightStatus, setTickerVal,
    showTranscriptPanel, hideTranscriptPanel,
    appendTranscriptInterim, appendTranscriptFinal,
    clearTranscript,
    startInsightStream, appendInsightChunk, finaliseInsight,
    wireSocketToFUI,
    activatePage, toggleSidebar, closeSidebar,
    toast,
    appendMessage, appendStreamMessage,
    appendStreamChunk, finaliseStreamMessage,
    animateScoreRing, animateStatBar,
    escHtml, timestamp,
  };

})();

// ── GLOBAL WRAPPERS ───────────────────────────────────────────
function nav(p)          { FUI.activatePage(p); }
function toggleSidebar() { FUI.toggleSidebar(); }
function closeSidebar()  { FUI.closeSidebar(); }
function clearTranscript(){ FUI.clearTranscript(); }

document.addEventListener('DOMContentLoaded', () => {
  FUI.init();
  if (typeof socketClient !== 'undefined') {
    FUI.wireSocketToFUI();
  }
});