/* ============================================================
   js/student.js — Student dashboard
   ============================================================ */
'use strict';

/* global FUI, API, Auth, MockAPI, MockModeUI,
          socketClient, CONFIG, isMockMode,
          setMockMode, getApiBaseUrl            */

const S = {
  user:          null,
  sessionId:     null,
  liveSessionId: null,
  lectureId:     null,
  lectureTitle:  null,
  chatMode:      'auto',    // default "auto" — Cell 9 detect_mode()
  isVoice:       false,
  recognition:   null,
  lectures:      [],
  quizData:      null,
  quizType:      'mcq',   // mcq | true_false | fill_blank | mixed
  quizAnswers:   {},
  studentId:     null,
  flashcards:    [],
  currentCard:   0,
  studyPlan:     null,
  pinnedMsgs:    [],    // [{id,role,content,timestamp}]
  _lastErrMsg:   '',    // last error text for retry
  _socketReconnecting: false,
};

// ── BOOT ──────────────────────────────────────────────────────

function CONFIRM(title, body, actionLabel, onConfirm) {
  let existing = document.getElementById('confirmOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmOverlay';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box fui-panel" style="padding:1.5rem">
      <div class="confirm-box-title">◈ ${escHtml(title)}</div>
      <div class="confirm-box-body">${escHtml(body)}</div>
      <div class="confirm-actions">
        <button class="btn btn-sm btn-ghost" id="confirmCancel">CANCEL</button>
        <button class="btn btn-sm btn-danger" id="confirmDoBtn">${escHtml(actionLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmCancel').onclick = () => { overlay.remove(); };
  overlay.querySelector('#confirmDoBtn').onclick  = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); }, { once: true });
}

document.addEventListener('DOMContentLoaded', async () => {
  // [10] allow "admin" on student page for testing
  S.user = Auth.requireAuth(['student', 'admin']);
  if (!S.user) return;

  S.studentId = S.user.id || S.user.username;
  S.sessionId = 'sess-' + S.studentId + '-' + Date.now();

  const nameEl = document.getElementById('sbName');
  const avEl   = document.getElementById('sbAv');
  if (nameEl) nameEl.textContent = S.user.username || '—';
  if (avEl)   avEl.textContent   = (S.user.username || 'S')[0].toUpperCase();

  initSocket();

  // Mode buttons
  document.getElementById('modeGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.mode-btn');
    if (!btn) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    S.chatMode = btn.dataset.mode;
    updateChatHint();
  });

  // Chat textarea
  const ta = document.getElementById('chatInput');
  ta?.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  });
  ta?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // [KYB] Keyboard shortcuts: Ctrl/Cmd+K → focus input, / → focus input
  document.addEventListener('keydown', (e) => {
    const isModK = (e.metaKey || e.ctrlKey) && e.key === 'k';
    if (isModK || (e.key === '/' && !e.target.matches('input,textarea,select'))) {
      e.preventDefault();
      ta?.focus();
    }
  });

  await Promise.allSettled([checkSystemStatus(), loadLectures()]);

  MockModeUI?.updateAll?.();
  initMockModeControls();

  // Boot overlay
  const loadOv   = document.getElementById('loadOv');
  const bootFill = document.getElementById('bootFill');
  const loadMsg  = document.getElementById('loadMsg');

  const bootSteps = [
    [30, 'Authenticating…'],
    [60, 'Loading lectures…'],
    [85, 'Connecting socket…'],
    [100,'Ready.'],
  ];
  for (const [pct, text] of bootSteps) {
    if (bootFill) bootFill.style.width = pct + '%';
    if (loadMsg)  loadMsg.textContent  = text;
    await sleep(250);
  }
  if (loadOv) loadOv.style.display = 'none';

  // Mini-map scroll indicator on library/sessions list panels
  initMiniMap();
});

// ── CONFIRM DIALOG ────────────────────────────────────────────

function CONFIRM(title, body, actionLabel, onConfirm) {
  let existing = document.getElementById('confirmOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'confirmOverlay';
  overlay.className = 'confirm-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="confirm-box fui-panel" style="padding:1.5rem">
      <div class="confirm-box-title">◈ ${escHtml(title)}</div>
      <div class="confirm-box-body">${escHtml(body)}</div>
      <div class="confirm-actions">
        <button class="btn btn-sm btn-ghost" id="confirmCancel">CANCEL</button>
        <button class="btn btn-sm btn-danger" id="confirmDoBtn">${escHtml(actionLabel)}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#confirmCancel').onclick = () => { overlay.remove(); };
  overlay.querySelector('#confirmDoBtn').onclick  = () => { overlay.remove(); onConfirm(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); }, { once: true });
}

// ── SOCKET ────────────────────────────────────────────────────

function initSocket() {
  try {
    socketClient.connect(getApiBaseUrl(), Auth.getToken());

    const rcBar  = document.getElementById('reconnectBar');
    const sendBtn = document.getElementById('sendBtn');

    socketClient.on('socket_connected',    () => {
      FUI?.setStatus?.('sockDot', 'online');
      S._socketReconnecting = false;
      if (rcBar)  rcBar.classList.remove('show');
      if (sendBtn) sendBtn.disabled = false;
    });

    socketClient.on('socket_disconnected', () => {
      FUI?.setStatus?.('sockDot', 'error');
      S._socketReconnecting = true;
      if (rcBar)  rcBar.classList.add('show');
      if (sendBtn) sendBtn.disabled = true;
    });
  } catch (e) {
    console.warn('[student] socket init failed:', e.message);
  }
}

// ── SYSTEM STATUS ─────────────────────────────────────────────

function updateDot(id, state) {       // state: null=loading amber | true=online green | false=offline red
  const el = document.getElementById(id);
  if (!el) return;
  if (state === null) el.className = 'sdot loading';
  else                el.className = 'sdot ' + (state ? 'online' : 'error');
}

async function checkSystemStatus() {
  updateDot('llmDot', null);
  if (isMockMode()) { updateDot('llmDot', true); return; }

  try {
    const res = await API.health();
    if (!res) { updateDot('llmDot', false); setEl('tkLlm', 'OFFLINE'); return; }

    const state = res.llm_state || (res.llm ? 'ready' : 'loading');

    switch (state) {
      case 'ready':
        updateDot('llmDot', true);
        setEl('tkLlm', 'ONLINE');
        break;
      case 'loading':
        updateDot('llmDot', null);
        setEl('tkLlm', 'LOADING…');
        setTimeout(checkSystemStatus, 15000);
        break;
      case 'failed':
        updateDot('llmDot', false);
        setEl('tkLlm', 'FAILED');
        break;
      case 'not_started':
        updateDot('llmDot', false);
        setEl('tkLlm', 'NOT STARTED');
        break;
      default:
        updateDot('llmDot', !!res.llm);
        setEl('tkLlm', res.llm ? 'ONLINE' : 'OFFLINE');
    }
  } catch (e) {
    updateDot('llmDot', false);
    setEl('tkLlm', 'OFFLINE');
  }
  // No auto-enable mock — student controls it manually
}

// ── NAV ───────────────────────────────────────────────────────

function nav(pageId) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.getElementById('pg-' + pageId)?.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === pageId);
  });

  const labels = {
    chat: 'AI Assistant', library: 'Lecture Library',
    sessions: 'Live Sessions', quiz: 'Quizzes',
    progress: 'My Progress', planner: 'Study Planner',
    flashcards: 'Flashcards', tools: 'AI Tools',
  };
  const bc = document.getElementById('bcPage');
  if (bc) bc.textContent = labels[pageId] || pageId;

  if (pageId === 'library')    loadLectures();
  if (pageId === 'sessions')   loadSessions();
  if (pageId === 'progress')   loadProgress();
  if (pageId === 'flashcards') renderFlashcardDeck();
}

// ── CHAT ──────────────────────────────────────────────────────

async function sendChat(retryMsg) {
  const ta  = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const txt = retryMsg || ta?.value.trim();
  if (!txt) return;

  if (!retryMsg) {
    ta.value = ''; ta.style.height = 'auto';
  }
  appendMsg('user', txt);
  setBtnLoading(btn, true);

  // remove stale reconnecting bar on fresh send
  const rcBar = document.getElementById('reconnectBar');
  if (rcBar) rcBar.classList.remove('show');

  try {
    if (isMockMode()) {
      const el = appendStreamEl();
      for await (const chunk of MockAPI.streamChat(txt)) {
        appendChunk(el, chunk); await sleep(20);
      }
      finaliseStream(el, 'AI · MOCK');
      return;
    }

    // [2] POST /ask — Cell 9 endpoint (not /chat)
    // [3] Streaming: POST /ask/stream yields {chunk: "text"}
    const el = appendStreamEl();
    let got  = false;

    for await (const data of API.stream('/ask/stream', {
      message:    txt,
      mode:       S.chatMode,
      session_id: S.sessionId,
      lecture_id: S.lectureId || undefined,
    })) {
      const chunk = data.chunk || data.token || '';
      if (chunk) { appendChunk(el, chunk); got = true; }
    }

    if (!got) {
      const res = await API.post('/ask', {
        message:    txt,
        mode:       S.chatMode,
        session_id: S.sessionId,
        lecture_id: S.lectureId || undefined,
      });
      el.textContent = res.answer || res.response || '—';
    }

    finaliseStream(el, `AI · ${S.chatMode.toUpperCase()}`);

  } catch (e) {
    const errText = '⚠ ' + (e.message || 'Request failed');
    S._lastErrMsg = txt;   // remember original question for retry
    appendMsg('ai', errText);
  } finally {
    setBtnLoading(btn, false);
  }
}

// Chat DOM helpers
function appendMsg(role, text) {
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;
  const isErr  = role === 'ai' && String(text).startsWith('⚠');
  const isAi   = role === 'ai';
  const isPin  = role === 'pin';
  const d = document.createElement('div');
  d.className = 'msg ' + (isErr ? 'ai' : role);

  let avLabel  = 'AI';
  let who      = 'ORIS';
  if (isPin)    { avLabel = 'PIN'; who = 'PINNED'; }
  else if (role === 'user') { avLabel = 'YOU'; who = 'YOU'; }

  // [PIN] Build footer
  let footerHtml = '';
  if (isErr) {
    footerHtml = `
      <div class="msg-footer">
        <button class="pin-btn" id="retryBtn" title="Retry">↺</button>
      </div>`;
  } else if (isAi || isPin) {
    const pLabel = isPin ? '★' : '☆';
    footerHtml = `
      <div class="msg-footer">
        <button class="pin-btn" id="pinBtn" title="${isPin ? 'Unpin' : 'Pin to sidebar'}">${pLabel}</button>
      </div>`;
  }

  d.innerHTML = `
    <div class="msg-av">${avLabel}</div>
    <div class="msg-content">
      <div class="msg-bub ${isErr ? 'err-msg' : ''}">${escHtml(text)}</div>
      ${isPin ? '' : `<div class="msg-meta">${who} · ${timestamp()}</div>`}
      ${footerHtml}
    </div>`;

  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;

  // Wire retry / pin handlers immediately
  if (isErr) {
    d.querySelector('#retryBtn')?.addEventListener('click', () => {
      if (S._lastErrMsg) sendChat(S._lastErrMsg);
    });
  } else if (!isErr && (isAi || isPin)) {
    const btnEl  = d.querySelector('#pinBtn');
    const msgId  = 'p-' + Date.now();
    d.id = msgId;
    btnEl?.addEventListener('click', () => {
      const pinned = btnEl.classList.toggle('pinned');
      if (pinned) {
        S.pinnedMsgs.push({
          id: msgId, role, content: text, timestamp: timestamp(),
        });
        savePinned();
        renderPinnedSidebar();
      } else {
        S.pinnedMsgs = S.pinnedMsgs.filter(p => p.id !== msgId);
        savePinned();
        renderPinnedSidebar();
      }
    });
  }
  return d;
}

// ── [THINKING] Shimmer bubble, hidden by first token ───────────

function hideThinking(_thBub) {
  if (_thBub) _thBub.classList.add('hidden');
}

function appendStreamEl() {
  const msgs = document.getElementById('chatMsgs');
  const d    = document.createElement('div');
  d.className = 'msg ai';
  d.innerHTML = `
    <div class="msg-av">AI</div>
    <div class="msg-content">
      <div class="thinking-bub" id="streamThBub">
        <span class="tb-dot"></span>
        <span class="tb-dot"></span>
        <span class="tb-dot"></span>
      </div>
      <div class="msg-bub streaming" id="streamBub"></div>
      <div class="msg-meta" id="streamMeta">THINKING…</div>
    </div>`;
  msgs?.appendChild(d);
  msgs && (msgs.scrollTop = msgs.scrollHeight);
  return d.querySelector('#streamBub');
}

function hideThinking(bub) {
  bub?.classList.add('hidden');
  const meta = bub?.parentElement?.querySelector('#streamMeta');
  if (meta) meta.textContent = 'STREAMING…';
}

// ── [CODE/BLOCK + MATH] Lightweight parse in appendChunk ───────
let _lastAppendTs = '';

function renderMarkdown(text) {
  if (!text) return text;

  let out = escHtml(text);

  // Math block   \(  ...  \)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g,
    '<div class="math-block">$1</div>');

  // Code block   ```lang   ```
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g,
    '<pre class="code-block"><code>$2</code></pre>');

  return out;
}

function appendChunk(el, chunk) {
  if (!el) return;
  const wasEmpty = !el.textContent;
  el.textContent += chunk;

  const parentMsg = el.closest('.msg');
  const parentOfMsg = parentMsg?.parentElement;

  // [1] Hide thinking bubble on first visible token
  if (wasEmpty) {
    const th = parentMsg?.querySelector('#streamThBub');
    if (th) hideThinking(th);
  }

  // [2] If active code fence is open, accumulate raw text then
  //     render on closing fence so the preview shows partial code live
  const accumEl = parentMsg?.querySelector('#chunkAccum');
  if (accumEl) {
    accumEl.textContent += chunk;
    const closed = chunk.includes('```');
    if (closed) {
      const raw  = accumEl.textContent;
      accumEl.remove();
      const html = renderMarkdown(raw);
      const tmp  = document.createElement('div');
      tmp.innerHTML = html;
      const nb = document.createElement('div');
      nb.className = 'code-block';
      nb.innerHTML = raw.replace(/</g,'&lt;');
      el.parentElement.replaceWith(nb);
    }
  }

  // ── autoscroll
  if (parentOfMsg) {
    parentOfMsg.scrollTop = parentOfMsg.scrollHeight;
  }
}

function finaliseStream(el, meta) {
  el?.classList.remove('streaming');
  // Final render of markdown on the bubble text
  if (el && el.textContent) {
    const html  = renderMarkdown(el.textContent);
    const tmpEl = document.createElement('div');
    tmpEl.innerHTML = html;
    // If it contains fences that are NOT closed, just render raw
    if (html.includes('```') && (!el.textContent.match(/```/g) || el.textContent.match(/```/g).length % 2 !== 0)) {
      // fence unclosed — leave as plain text
    } else {
      el.innerHTML = html;
    }
  }
  const metaEl = el?.parentElement?.querySelector('#streamMeta');
  if (metaEl) metaEl.textContent = meta + ' · ' + timestamp();
}

function clearChat() {
  const msgs = document.getElementById('chatMsgs');
  if (msgs) msgs.innerHTML = `
    <div class="msg ai">
      <div class="msg-av">AI</div>
      <div class="msg-content">
        <div class="msg-bub">Neural link re-established. Ready for queries. 🎓</div>
        <div class="msg-meta">SYSTEM · RESET</div>
      </div>
    </div>`;
}

function updateChatHint() {
  const modeLbl = document.getElementById('modeLbl');
  const ctxLbl  = document.getElementById('ctxLbl');
  const modeInd = document.getElementById('chatModeIndicator');
  if (modeLbl) modeLbl.textContent = S.chatMode.toUpperCase();
  if (ctxLbl)  ctxLbl.textContent  = S.lectureTitle ? S.lectureTitle.slice(0, 20) + '…' : 'NONE';
  if (modeInd) modeInd.textContent = S.lectureId ? 'RAG + SMART' : 'SMART AI';
}

// ── VOICE ─────────────────────────────────────────────────────

function toggleVoice() {
  if (!S.isVoice) {
    try {
      S.recognition = socketClient.createSpeechRecognizer(
        (text, isFinal) => {
          const ta = document.getElementById('chatInput');
          if (ta) ta.value = text;
          if (isFinal) { sendChat(); stopVoice(); }
        },
        () => stopVoice()
      );
      S.recognition.start();
      S.isVoice = true;
      document.getElementById('voiceBtn')?.classList.add('listening');
    } catch (e) { console.warn('Voice error:', e.message); }
  } else { stopVoice(); }
}

function stopVoice() {
  try { S.recognition?.stop(); } catch {}
  S.recognition = null; S.isVoice = false;
  document.getElementById('voiceBtn')?.classList.remove('listening');
}

// ── LIBRARY ───────────────────────────────────────────────────

async function loadLectures() {
  try {
    if (isMockMode()) { S.lectures = MockAPI?.getLectures?.()?.lectures || []; }
    else {
      // [4] GET /lectures → array of lecture objects
      // Cell 9 returns array directly or {lectures: [...]}
      const res    = await API.get('/lectures');
      S.lectures   = Array.isArray(res) ? res : (res.lectures || res || []);
    }
    renderLectures(S.lectures);
    populateQuizLectures(S.lectures);
  } catch (e) {
    console.warn('[student] load lectures:', e.message);
    document.getElementById('lecGrid') && (document.getElementById('lecGrid').innerHTML =
      '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>FAILED TO LOAD LECTURES</div></div>');
  }
}

function renderLectures(lectures) {
  const grid = document.getElementById('lecGrid');
  if (!grid) return;
  if (!lectures.length) {
    grid.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO LECTURES AVAILABLE</div></div>';
    return;
  }
  grid.innerHTML = lectures.map(l => `
    <div class="lec-card ${l.id === S.lectureId ? 'active-ctx' : ''}"
         onclick="selectLecture('${l.id}','${escHtml(l.title || '')}')">
      <div style="font-family:var(--fd);font-size:.78rem;color:var(--white);margin-bottom:.25rem">
        ${escHtml(l.title || 'Untitled')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.75rem">
        <span class="lp-badge">${l.file_type?.toUpperCase() || 'DOC'}</span>
        <span style="font-size:.58rem;color:${l.id === S.lectureId ? 'var(--cyan)' : 'var(--text3)'}">
          ${l.id === S.lectureId ? '● ACTIVE CONTEXT' : 'CLICK TO SELECT'}
        </span>
      </div>
    </div>`).join('');
}

function filterLectures() {
  const q = document.getElementById('libSearch')?.value.toLowerCase() || '';
  renderLectures(S.lectures.filter(l => (l.title || '').toLowerCase().includes(q)));
}

function selectLecture(id, title) {
  S.lectureId = id; S.lectureTitle = title;
  const ctxDisplay = document.getElementById('ctxDisplay');
  if (ctxDisplay) ctxDisplay.innerHTML = `
    <div style="font-size:.68rem;color:var(--cyan)">${escHtml(title)}</div>
    <span style="cursor:pointer;color:var(--red);margin-left:.3rem;font-size:.85rem;line-height:1" title="Clear context" onclick="clearLecture()">×</span>`;
  updateChatHint(); renderLectures(S.lectures);
  nav('chat');
}

function clearLecture() {
  S.lectureId = null; S.lectureTitle = null;
  const ctxDisplay = document.getElementById('ctxDisplay');
  if (ctxDisplay) ctxDisplay.innerHTML = '<span class="ctx-empty">No lecture selected</span>';
  updateChatHint();
}

// ── [PIN] Helpers ─────────────────────────────────────────────

function savePinned() {
  try { localStorage.setItem(CONFIG.PINNED_KEY || 'pinned', JSON.stringify(S.pinnedMsgs)); } catch {}
}

function renderPinnedSidebar() {
  const panel  = document.getElementById('pinnedPanel');
  const empty  = document.getElementById('pinnedEmpty');
  const list   = panel?.querySelector('#pinnedList');
  const wrapEl = list?.parentElement; // .cs-block

  if (!list) return;

  if (!S.pinnedMsgs.length) {
    list.style.display = 'none';
    if (empty) empty.style.display = 'block';
    if (wrapEl) wrapEl.classList.add('hidden');
    return;
  }
  if (empty)  empty.style.display  = 'none';
  if (wrapEl) wrapEl.classList.remove('hidden');
  list.style.display = 'flex';
  list.innerHTML = S.pinnedMsgs.map(p => `
    <div style="font-size:.62rem;color:var(--text2);padding:.3rem .6rem;background:rgba(255,200,0,.04);border:1px solid rgba(255,200,0,.1);border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escHtml(p.content)}">${escHtml(p.content.slice(0,60))}${p.content.length>60?'\u2026':''}</div>
  `).join('');
}

// ── LIVE SESSIONS ─────────────────────────────────────────────

async function loadSessions() {
  try {
    let sessions;
    if (isMockMode()) {
      sessions = MockAPI?.getSessions?.()?.sessions || [];
    } else {
      // [5] GET /sessions — returns all active sessions
      const res = await API.get('/sessions');
      sessions  = Array.isArray(res) ? res : (res.sessions || []);
    }
    renderSessions(sessions);
  } catch (e) {
    console.warn('[student] load sessions:', e.message);
    const list = document.getElementById('sessListSt');
    if (list) list.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO ACTIVE SESSIONS</div></div>';
  }
}

function renderSessions(sessions) {
  const list = document.getElementById('sessListSt');
  if (!list) return;
  if (!sessions.length) {
    list.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO ACTIVE SESSIONS</div><div style="margin-top:.5rem;font-size:.62rem;color:var(--text3)">Check back when your lecturer starts a session</div></div>';
    return;
  }
  list.innerHTML = sessions.map(s => {
    const sid = s.session_id || s.id;
    return `<div class="fui-panel" style="padding:1.25rem;border-color:rgba(255,0,110,0.15)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div>
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem">
            <div style="width:8px;height:8px;border-radius:50%;background:var(--red);box-shadow:0 0 6px var(--red);animation:pulse .9s ease-in-out infinite"></div>
            <span style="font-family:var(--fd);font-size:.75rem;color:var(--red);letter-spacing:.1em">LIVE</span>
          </div>
          <div style="font-family:var(--fb);font-size:.95rem;color:var(--white);font-weight:600">${escHtml(s.title || 'Live Session')}</div>
          <div style="font-family:var(--fm);font-size:.65rem;color:var(--text3);margin-top:.2rem">ID: ${sid}</div>
        </div>
        <button class="btn" onclick="joinSession('${sid}')">JOIN SESSION</button>
      </div>
    </div>`;
  }).join('');
}

let _studentWS = null;

async function joinSession(sessionId) {
  S.liveSessionId = sessionId;

  // Socket join — [1] pass user_id
  if (socketClient.connected) {
    socketClient.joinSession(sessionId, S.studentId);
  }

  // Connect dedicated WebSocket for live engine events
  connectStudentWS(sessionId);

  // Show active session HUD
  const wrap = document.getElementById('sessActiveWrap');
  if (wrap) wrap.classList.remove('hidden');
  const txSid = document.getElementById('txSessionId');
  if (txSid) txSid.textContent = sessionId;

  // Update session context in chat sidebar
  const sessCtx = document.getElementById('sessCtxDisplay');
  if (sessCtx) sessCtx.innerHTML =
    `<span style="color:var(--red)">● LIVE</span><span style="color:var(--text2)"> ${sessionId}</span>`;

  nav('sessions');
}

function connectStudentWS(sessionId) {
  try {
    if (_studentWS) { try { _studentWS.close(); } catch {} }

    const base = getApiBaseUrl()
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    // [8] Cell 8 WebSocket route: /live/student/{session_id}?student_id=...
    const url = `${base}/live/student/${sessionId}?student_id=${encodeURIComponent(S.studentId)}`;
    _studentWS = new WebSocket(url);

    _studentWS.onopen    = () => console.log('[ws] student connected:', sessionId);
    _studentWS.onmessage = (evt) => {
      try { routeStudentWS(JSON.parse(evt.data)); } catch {}
    };
    _studentWS.onclose = () => console.log('[ws] student disconnected');
    _studentWS.onerror = (e) => console.warn('[ws] student error:', e);
  } catch (e) {
    console.warn('[student] WS failed:', e.message);
  }
}

function routeStudentWS(msg) {
  const type    = msg.type    || '';
  const payload = msg.payload || {};

  switch (type) {
    case 'transcript:interim':
      appendTxInterim(payload.text || '');
      break;

    case 'transcript:final': {
      const snap = payload.snapshot;
      appendTxFinal(payload.text || '', payload.confidence || 1.0, snap);
      break;
    }

    case 'insight:student:chunk': {
      const { insight_id, chunk } = payload;
      appendInsightChunk(insight_id, chunk);
      break;
    }

    case 'insight:student:done':
      finaliseInsight(payload.insight_id);
      break;
  }
}

// Transcript DOM
let _txSegments  = 0;
let _txWords     = 0;
let _txScrollFrozen = false;

function toggleTxScroll() {
  _txScrollFrozen = !_txScrollFrozen;
  const btn = document.querySelector('.freeze-btn[data-panel="tx"]');
  if (btn) btn.classList.toggle('active', _txScrollFrozen);
}

function _txDoScroll() {
  const content = document.getElementById('txContent');
  if (content && !_txScrollFrozen) {
    content.scrollTop = content.scrollHeight;
  }
}

function appendTxFinal(text, confidence, isSnapshot) {
  const waiting = document.getElementById('txWaiting');
  if (waiting) waiting.style.display = 'none';

  const content = document.getElementById('txContent');
  if (!content) return;

  const el = document.createElement('div');
  el.className = 'tx-segment';
  el.textContent = text;
  content.appendChild(el);
  _txDoScroll();

  _txSegments++;
  _txWords += text.split(/\s+/).length;

  const wc = document.getElementById('txWordCount');
  if (wc) wc.textContent = _txWords + ' WORDS';
  const segs = document.getElementById('txSegs');
  if (segs) segs.textContent = _txSegments;
  const conf = document.getElementById('txConf');
  if (conf) conf.textContent = Math.round((confidence || 1) * 100) + '%';
}

function appendTxInterim(text) {
  const el = document.getElementById('txInterim');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}

function _doClearTranscript() {
  _txSegments = 0; _txWords = 0;
  const content  = document.getElementById('txContent');
  const interim  = document.getElementById('txInterim');
  const waiting  = document.getElementById('txWaiting');
  const wc       = document.getElementById('txWordCount');
  const segs     = document.getElementById('txSegs');
  if (content) content.innerHTML = '';
  if (interim) { interim.textContent=''; interim.classList.add('hidden'); }
  if (waiting) waiting.style.display = '';
  if (wc)    wc.textContent    = '0 WORDS';
  if (segs)  segs.textContent  = '0';
}

// ── MINI-MAP / SCROLL PROGRESS ─────────────────────────────────

function initMiniMap() {
  document.querySelectorAll('.tx-scroll, .sb-nav, [class*="scroll"]').forEach(scroll => {
    if (scroll.querySelector('.mini-map-track')) return;
    if (scroll.clientHeight >= scroll.scrollHeight + 4) return;

    const track = document.createElement('div');
    track.className = 'mini-map-track';
    const thumb = document.createElement('div');
    thumb.className = 'mini-map-thumb';
    track.appendChild(thumb);
    scroll.appendChild(track);

    const update = () => {
      const t  = scroll.scrollTop;
      const sh = scroll.scrollHeight;
      const ch = scroll.clientHeight;
      if (sh <= ch) { thumb.style.display = 'none'; return; }
      thumb.style.display  = '';
      thumb.style.top      = (t / (sh - ch)) * 100 + '%';
      thumb.style.height   = Math.max((ch / sh) * 100, 3) + '%';
    };
    scroll.addEventListener('scroll', update, { passive: true });
    // also observer for content size changes
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(update).observe(scroll);
    }
    update();
  });
}

// Insight DOM
const _insightBuffers = {};
let   _insightCount   = 0;

function appendInsightChunk(insightId, chunk) {
  const waiting = document.getElementById('insightWaiting');
  if (waiting) waiting.style.display = 'none';

  const content = document.getElementById('insightContent');
  if (!content) return;

  if (!_insightBuffers[insightId]) {
    const el = document.createElement('div');
    el.className  = 'insight-card streaming';
    el.id         = 'ins-' + insightId;
    el.textContent = '';
    content.appendChild(el);
    content.scrollTop = content.scrollHeight;
    _insightBuffers[insightId] = el;
  }

  _insightBuffers[insightId].textContent += chunk;
  content.scrollTop = content.scrollHeight;
}

function finaliseInsight(insightId) {
  const el = _insightBuffers[insightId];
  if (el) el.classList.remove('streaming');
  delete _insightBuffers[insightId];

  _insightCount++;
  const badge = document.getElementById('insightCount');
  if (badge) badge.textContent = _insightCount + ' INSIGHTS';
}

function leaveSession() {
  CONFIRM(
    'LEAVE SESSION',
    'Are you sure you want to leave the live session? The live transcript will close.',
    'LEAVE',
    () => {
      if (_studentWS) { try { _studentWS.close(); } catch {} _studentWS = null; }
      if (socketClient.connected) socketClient.leaveSession(S.liveSessionId, S.studentId);
      S.liveSessionId = null;
      const wrap = document.getElementById('sessActiveWrap');
      if (wrap) wrap.classList.add('hidden');
      _doClearTranscript();
      const sessCtx = document.getElementById('sessCtxDisplay');
      if (sessCtx) sessCtx.innerHTML = '<span class="ctx-empty">Not in session</span>';
    }
  );
}

function clearChat() {
  CONFIRM(
    'CLEAR CHAT',
    'This will erase your entire conversation history.',
    'CLEAR',
    () => {
      const msgs = document.getElementById('chatMsgs');
      if (msgs) msgs.innerHTML = `
        <div class="msg ai">
          <div class="msg-av">AI</div>
          <div class="msg-content">
            <div class="msg-bub">Neural link re-established. Ready for queries. 🎓</div>
            <div class="msg-meta">SYSTEM · RESET</div>
          </div>
        </div>`;
    }
  );
}

function clearTranscript() {
  CONFIRM(
    'CLEAR TRANSCRIPT',
    'Erase the live transcript for this session?',
    'CLEAR',
    () => {
      _txSegments = 0; _txWords = 0;
      const content  = document.getElementById('txContent');
      const interim  = document.getElementById('txInterim');
      const waiting  = document.getElementById('txWaiting');
      const wc       = document.getElementById('txWordCount');
      const segs     = document.getElementById('txSegs');
      if (content) content.innerHTML = '';
      if (interim) { interim.textContent=''; interim.classList.add('hidden'); }
      if (waiting) waiting.style.display = '';
      if (wc)    wc.textContent    = '0 WORDS';
      if (segs)  segs.textContent  = '0';
    }
  );
}

// ── QUIZ ──────────────────────────────────────────────────────

function populateQuizLectures(lectures) {
  populateAllLectureSelects(lectures);
}

function populateAllLectureSelects(lectures) {
  ['quizLecSel','flashcardLecSel','studyPlanLecSel',
   'conceptMapLecSel','debateLecSel','essayLecSel'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— SELECT LECTURE —</option>';
    (lectures || S.lectures).forEach(l => {
      const o = document.createElement('option');
      o.value = l.id; o.textContent = l.title || l.id;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });
}

async function generateQuiz() {
  const lecId = document.getElementById('quizLecSel')?.value;
  const num   = parseInt(document.getElementById('quizNumSel')?.value || '5');
  const diff  = document.getElementById('quizDiffSel')?.value || 'medium';
  const type  = document.getElementById('quizTypeSel')?.value || 'mcq';
  const bloom = document.getElementById('quizBloomSel')?.value || null;

  if (!lecId) { alert('Please select a lecture'); return; }
  const btn = document.getElementById('genQuizBtn');
  setBtnLoading(btn, true);

  try {
    S.quizType = type;
    let res;

    if (isMockMode()) {
      await sleep(800); res = { questions: MockAPI?.getQuiz?.(num)?.questions || [] };
    } else {
      switch (type) {
        case 'true_false': res = await API.generateTrueFalse(lecId, num); break;
        case 'fill_blank': res = await API.generateFillBlank(lecId, num); break;
        case 'mixed':      res = await API.generateMixedQuiz(lecId, num); break;
        default:           res = await API.post('/quiz/generate', { lecture_id:lecId, num_questions:num, difficulty:diff });
      }
    }

    const questions = Array.isArray(res) ? res : (res?.questions || res || []);
    S.quizData = questions; S.quizAnswers = {};
    renderQuiz(questions, type);

    document.getElementById('quizSetupWrap')?.classList.add('hidden');
    document.getElementById('quizWrap')?.classList.remove('hidden');
    document.getElementById('quizResult')?.classList.add('hidden');

  } catch (e) { alert('Quiz failed: ' + e.message); }
  finally { setBtnLoading(btn, false); }
}

function renderQuiz(questions, type) {
  const wrap = document.getElementById('quizContent');
  if (!wrap) return;
  const qtype = type || S.quizType || 'mcq';

  wrap.innerHTML = questions.map((q, i) => {
    const qt = q.type || qtype || 'mcq';

    if (qt === 'true_false') {
      return `
        <div class="quiz-card" id="qc-${i}">
          <div class="quiz-card-num">Q${i+1} · TRUE/FALSE</div>
          <div class="quiz-card-q">${escHtml(q.statement || q.question || '')}</div>
          <div class="quiz-opts" id="qopts-${i}">
            <button class="quiz-opt" data-q="${i}" data-opt="true"  onclick="selectAnswer(${i},this)">✅ True</button>
            <button class="quiz-opt" data-q="${i}" data-opt="false" onclick="selectAnswer(${i},this)">❌ False</button>
          </div>
        </div>`;
    }

    if (qt === 'fill_blank') {
      const hint = q.hint ? `<div style="font-size:.65rem;color:var(--text3);margin-top:.3rem">Hint: ${escHtml(q.hint)}</div>` : '';
      return `
        <div class="quiz-card" id="qc-${i}">
          <div class="quiz-card-num">Q${i+1} · FILL THE BLANK</div>
          <div class="quiz-card-q">${escHtml(q.sentence || '')}</div>
          ${hint}
          <div style="margin-top:.75rem">
            <input type="text" class="finput" id="fill-${i}" placeholder="Your answer…"
                   style="max-width:300px"
                   onchange="S.quizAnswers[${i}]=this.value"/>
          </div>
        </div>`;
    }

    // MCQ (default) — also handles mixed with per-question type
    return `
      <div class="quiz-card" id="qc-${i}">
        <div class="quiz-card-num">
          Q${i+1}${q.bloom_level ? ` · ${q.bloom_level.toUpperCase()}` : ''}
          ${q.difficulty ? `<span style="float:right;font-size:.6rem;color:var(--text3)">${q.difficulty}</span>` : ''}
        </div>
        <div class="quiz-card-q">${escHtml(q.question || '')}</div>
        <div class="quiz-opts" id="qopts-${i}">
          ${(q.options || []).map(opt => `
            <button class="quiz-opt" data-q="${i}" data-opt="${escHtml(opt)}"
                    onclick="selectAnswer(${i},this)">${escHtml(opt)}</button>`).join('')}
        </div>
      </div>`;
  }).join('');
}

function selectAnswer(qIndex, btn) {
  document.querySelectorAll(`#qopts-${qIndex} .quiz-opt`)
          .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  S.quizAnswers[qIndex] = btn.dataset.opt;
}

async function submitQuiz() {
  if (!S.quizData) return;
  const total    = S.quizData.length;
  const answered = Object.keys(S.quizAnswers).length;

  // Handle fill-blank answers from inputs
  if (S.quizType === 'fill_blank') {
    S.quizData.forEach((_, i) => {
      const inp = document.getElementById('fill-' + i);
      if (inp && inp.value) S.quizAnswers[i] = inp.value.trim();
    });
  }

  if (Object.keys(S.quizAnswers).length < total) {
    alert(`Answer all questions (${answered}/${total})`); return;
  }

  let correct = 0;
  S.quizData.forEach((q, i) => {
    const chosen   = String(S.quizAnswers[i] || '').toLowerCase();
    const expected = String(q.correct || (q.answer !== undefined ? q.answer : (q.answers?.[0] || ''))).toLowerCase();
    const isRight  = chosen === expected || (q.answers || []).some(a => chosen.includes(a.toLowerCase()));
    if (isRight) correct++;

    if (S.quizType !== 'fill_blank') {
      document.querySelectorAll(`#qopts-${i} .quiz-opt`).forEach(btn => {
        btn.disabled = true;
        const bval   = String(btn.dataset.opt).toLowerCase();
        if (bval === expected)                   btn.classList.add('correct');
        else if (bval === chosen && !isRight)    btn.classList.add('wrong');
      });
    }
  });

  const pct = Math.round((correct / total) * 100);

  if (!isMockMode()) {
    try {
      await API.post('/quiz/submit', {
        lecture_id: document.getElementById('quizLecSel')?.value || null,
        questions:  S.quizData,
        answers:    S.quizData.map((_, i) => S.quizAnswers[i] || ''),
        difficulty: document.getElementById('quizDiffSel')?.value || 'medium',
      });
    } catch (e) { console.warn('[student] quiz submit:', e.message); }
  }

  saveQuizHistory({
    score: pct, correct, total,
    date:  new Date().toLocaleDateString(),
    type:  S.quizType,
    lecture: S.lectures.find(l => l.id === document.getElementById('quizLecSel')?.value)?.title || '—',
  });

  showQuizResult(pct, correct, total);
}

function showQuizResult(pct, correct, total) {
  document.getElementById('quizResult')?.classList.remove('hidden');
  const detail = document.getElementById('qScoreDetail');
  if (detail) detail.textContent = `${correct} of ${total} correct · ${pct >= 70 ? 'Well done!' : 'Keep practising!'}`;
  const val = document.getElementById('qScoreVal');
  if (val) val.textContent = pct + '%';
  // Score ring animation
  const circle = document.getElementById('qrFillCircle');
  if (circle) {
    const circ = 2 * Math.PI * 42;
    circle.style.strokeDashoffset = circ - (pct / 100) * circ;
    circle.style.stroke = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--yellow)' : 'var(--red)';
    circle.style.transition = 'stroke-dashoffset 1s ease, stroke .3s';
  }
}

function resetQuiz() {
  S.quizData = null; S.quizAnswers = {};
  document.getElementById('quizSetupWrap')?.classList.remove('hidden');
  document.getElementById('quizWrap')?.classList.add('hidden');
  document.getElementById('quizResult')?.classList.add('hidden');
  document.getElementById('quizContent') && (document.getElementById('quizContent').innerHTML = '');
}

function saveQuizHistory(entry) {
  try {
    const raw = localStorage.getItem(CONFIG.QUIZ_HISTORY_KEY);
    const h   = raw ? JSON.parse(raw) : [];
    h.unshift(entry);
    if (h.length > 50) h.pop();
    localStorage.setItem(CONFIG.QUIZ_HISTORY_KEY, JSON.stringify(h));
  } catch {}
}

// ── PROGRESS ──────────────────────────────────────────────────

// [9] No /progress endpoint — use local quiz history
async function loadProgress() {
  const localHistory = getLocalQuizHistory();
  const total  = localHistory.length;
  const avg    = total ? Math.round(localHistory.reduce((a, h) => a + h.score, 0) / total) : 0;

  setEl('statTotalQuizzes', total);
  setEl('statAvgScore',     avg + '%');
  setEl('statStreak',       '—');
  setEl('statTopTopic',     '—');

  renderQuizHistory(localHistory);
}

function getLocalQuizHistory() {
  try { return JSON.parse(localStorage.getItem(CONFIG.QUIZ_HISTORY_KEY) || '[]'); }
  catch { return []; }
}

function renderQuizHistory(history) {
  const list = document.getElementById('quizHistory');
  if (!list) return;
  if (!history?.length) {
    list.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO QUIZ HISTORY YET</div></div>';
    return;
  }
  list.innerHTML = history.map(h => `
    <div class="qh-item">
      <span style="color:var(--text2);flex:1">${escHtml(h.lecture||'—')}</span>
      <span style="font-size:.62rem;color:var(--text3);margin-right:.5rem">${h.type||'mcq'}</span>
      <span style="font-size:.65rem;color:var(--text3);margin-right:.75rem">${h.date||'—'}</span>
      <span style="color:${h.score>=70?'var(--green)':h.score>=50?'var(--yellow)':'var(--red)'}">${h.score}%</span>
    </div>`).join('');
}

// ── FLASHCARDS ────────────────────────────────────────────────

async function generateFlashcards() {
  const lecId = document.getElementById('flashcardLecSel')?.value;
  const num   = parseInt(document.getElementById('flashcardNumSel')?.value || '10');
  if (!lecId) { alert('Select a lecture'); return; }

  const btn = document.getElementById('genFlashcardBtn');
  setBtnLoading(btn, true);

  try {
    const res    = await API.generateFlashcards(lecId, num);
    S.flashcards = Array.isArray(res) ? res : [];
    S.currentCard = 0;
    renderFlashcardDeck();
    document.getElementById('flashcardSetup')?.classList.add('hidden');
    document.getElementById('flashcardDeck')?.classList.remove('hidden');
  } catch (e) { alert('Flashcard generation failed: ' + e.message); }
  finally { setBtnLoading(btn, false); }
}

function renderFlashcardDeck() {
  if (!S.flashcards.length) return;
  const card = S.flashcards[S.currentCard];
  if (!card) return;

  setEl('fcProgress',  `${S.currentCard + 1} / ${S.flashcards.length}`);
  setEl('fcTopic',     card.topic || '—');
  setEl('fcDifficulty', card.difficulty || '—');
  setEl('fcFront',     card.front || '');
  setEl('fcBack',      card.back  || '');

  // Reset flip state
  document.getElementById('flashcard')?.classList.remove('flipped');
}

function flipCard() {
  document.getElementById('flashcard')?.classList.toggle('flipped');
}

function nextCard() {
  if (S.currentCard < S.flashcards.length - 1) {
    S.currentCard++; renderFlashcardDeck();
  }
}

function prevCard() {
  if (S.currentCard > 0) { S.currentCard--; renderFlashcardDeck(); }
}

function shuffleCards() {
  for (let i = S.flashcards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [S.flashcards[i], S.flashcards[j]] = [S.flashcards[j], S.flashcards[i]];
  }
  S.currentCard = 0; renderFlashcardDeck();
}

function resetFlashcards() {
  S.flashcards = []; S.currentCard = 0;
  document.getElementById('flashcardSetup')?.classList.remove('hidden');
  document.getElementById('flashcardDeck')?.classList.add('hidden');
}

// ── STUDY PLAN ────────────────────────────────────────────────

async function generateStudyPlan() {
  const topic   = document.getElementById('studyPlanTopic')?.value.trim();
  const lecId   = document.getElementById('studyPlanLecSel')?.value;
  const days    = parseInt(document.getElementById('studyPlanDays')?.value || '7');
  const hours   = parseFloat(document.getElementById('studyPlanHours')?.value || '2');
  const out     = document.getElementById('studyPlanOutput');
  const btn     = document.getElementById('genStudyPlanBtn');

  if (!topic) { alert('Enter a topic'); return; }
  setBtnLoading(btn, true);
  if (out) out.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>GENERATING PLAN…</div></div>';

  try {
    const res = await API.generateStudyPlan(topic, lecId, days, hours);
    S.studyPlan = res;
    renderStudyPlan(res, out);
  } catch (e) {
    if (out) out.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`;
  } finally { setBtnLoading(btn, false); }
}

function renderStudyPlan(plan, container) {
  if (!container) return;
  if (!plan || !plan.plan) {
    container.innerHTML = `<pre style="font-size:.72rem;color:var(--text2);white-space:pre-wrap">${escHtml(JSON.stringify(plan, null, 2))}</pre>`;
    return;
  }

  const tipsList = (plan.tips || []).map(t => `<li>${escHtml(t)}</li>`).join('');
  const dayCards = plan.plan.map(d => `
    <div class="fui-panel" style="padding:1rem;margin-bottom:.75rem">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem">
        <span class="lp-badge">${escHtml(d.label || 'Day '+d.day)}</span>
        <span style="font-size:.65rem;color:var(--cyan)">${(d.bloom_level||'').toUpperCase()}</span>
      </div>
      <div style="font-size:.72rem;color:var(--text2);margin-bottom:.5rem">${escHtml(d.focus||'')}</div>
      ${(d.objectives||[]).map(o=>`<div style="font-size:.65rem;color:var(--text3);margin-bottom:.2rem">▸ ${escHtml(o)}</div>`).join('')}
      <div style="margin-top:.5rem">
        ${(d.activities||[]).map(a=>`
          <div style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border)">
            <span class="lp-badge" style="font-size:.58rem">${escHtml(a.type||'')}</span>
            <span style="font-size:.68rem;flex:1">${escHtml(a.description||'')}</span>
            <span style="font-size:.6rem;color:var(--text3)">${a.duration_min||0}m</span>
          </div>`).join('')}
      </div>
      ${d.key_concepts?.length ? `<div style="margin-top:.4rem;font-size:.62rem;color:var(--text3)">
        Key: ${d.key_concepts.map(c=>`<span class="lp-badge" style="font-size:.55rem">${escHtml(c)}</span>`).join(' ')}
      </div>` : ''}
    </div>`).join('');

  container.innerHTML = `
    <div style="margin-bottom:.75rem;padding:.75rem;background:rgba(0,255,255,.05);border-radius:8px">
      <div style="font-size:.78rem;font-weight:600;color:var(--white)">${escHtml(plan.topic||'Study Plan')}</div>
      <div style="font-size:.65rem;color:var(--text3)">${plan.duration_days||7} days · ${plan.daily_hours||2}h/day</div>
      ${plan.weak_topic_focus?.length ? `<div style="font-size:.62rem;color:var(--amber);margin-top:.3rem">Focus areas: ${plan.weak_topic_focus.join(', ')}</div>` : ''}
    </div>
    ${dayCards}
    ${tipsList ? `<div style="padding:.75rem;background:rgba(255,200,0,.05);border-radius:8px">
      <div style="font-size:.72rem;font-weight:600;color:var(--amber);margin-bottom:.4rem">💡 Study Tips</div>
      <ul style="font-size:.68rem;color:var(--text2);padding-left:1.2rem">${tipsList}</ul>
    </div>` : ''}`;
}

// ── AI TOOLS (concept map, debate, essay, socratic) ───────────

async function runConceptMap() {
  const lecId = document.getElementById('conceptMapLecSel')?.value;
  const out   = document.getElementById('conceptMapOutput');
  const btn   = document.getElementById('runConceptMapBtn');
  setBtnLoading(btn, true);
  if (out) out.innerHTML = '';
  try {
    const res = await API.generateConceptMap(lecId);
    const text = res?.answer || res?.response || (typeof res === 'string' ? res : '');
    if (out) out.innerHTML = `<div style="font-size:.78rem;color:var(--text2);line-height:1.7;white-space:pre-wrap">${escHtml(text)}</div>`;
  } catch (e) { if (out) out.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`; }
  finally { setBtnLoading(btn, false); }
}

async function runDebate() {
  const topic = document.getElementById('debateTopic')?.value.trim();
  const lecId = document.getElementById('debateLecSel')?.value;
  const out   = document.getElementById('debateOutput');
  const btn   = document.getElementById('runDebateBtn');
  if (!topic) { alert('Enter a debate topic'); return; }
  setBtnLoading(btn, true);
  if (out) out.innerHTML = '';
  try {
    const res = await API.generateDebate(topic, lecId);
    const text = res?.answer || res?.response || (typeof res === 'string' ? res : '');
    if (out) out.innerHTML = `<div style="font-size:.78rem;color:var(--text2);line-height:1.7;white-space:pre-wrap">${escHtml(text)}</div>`;
  } catch (e) { if (out) out.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`; }
  finally { setBtnLoading(btn, false); }
}

async function runEssay() {
  const prompt = document.getElementById('essayPrompt')?.value.trim();
  const lecId  = document.getElementById('essayLecSel')?.value;
  const length = document.getElementById('essayLength')?.value || 'medium';
  const out    = document.getElementById('essayOutput');
  const btn    = document.getElementById('runEssayBtn');
  if (!prompt) { alert('Enter an essay question'); return; }
  setBtnLoading(btn, true);
  if (out) out.innerHTML = '';
  try {
    const res = await API.writeEssay(prompt, lecId, length);
    const text = res?.answer || res?.response || (typeof res === 'string' ? res : '');
    if (out) out.innerHTML = `<div style="font-size:.78rem;color:var(--text2);line-height:1.7;white-space:pre-wrap">${escHtml(text)}</div>`;
  } catch (e) { if (out) out.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`; }
  finally { setBtnLoading(btn, false); }
}

async function runSocratic() {
  const topic   = document.getElementById('socraticTopic')?.value.trim();
  const current = document.getElementById('socraticCurrent')?.value.trim();
  const out     = document.getElementById('socraticOutput');
  const btn     = document.getElementById('runSocraticBtn');
  if (!topic) { alert('Enter a topic'); return; }
  setBtnLoading(btn, true);
  if (out) out.innerHTML = '';
  try {
    const res = await API.socraticGuide(topic, current, S.sessionId);
    const text = res?.answer || res?.response || (typeof res === 'string' ? res : '');
    if (out) out.innerHTML = `<div class="fui-panel" style="padding:1rem;font-size:.82rem;color:var(--text2);line-height:1.6">${escHtml(text)}</div>`;
  } catch (e) { if (out) out.innerHTML = `<div style="color:var(--red)">${escHtml(e.message)}</div>`; }
  finally { setBtnLoading(btn, false); }
}

async function generatePlan() {
  const hours = document.getElementById('plannerHours')?.value || '2';
  const exam  = document.getElementById('plannerExam')?.value || '';
  const topic = document.getElementById('plannerTopic')?.value.trim();
  const out   = document.getElementById('plannerOutput');
  const btn   = document.querySelector('#pg-planner .btn');

  if (!topic) { alert('Please enter a topic'); return; }

  setBtnLoading(btn, true);
  if (out) out.classList.add('hidden');

  try {
    let plan = '';
    if (isMockMode()) {
      plan = `STUDY PLAN: ${topic}\n\nWeek 1: Foundations\n- Day 1-2: Core concepts\n- Day 3-4: Practice\n- Day 5: Review\n\nDaily: ${hours} hours`;
    } else {
      // POST /ask in "smart" mode
      const res = await API.post('/ask', {
        message:    `Create a study plan for: ${topic}. Available: ${hours} hours/day.${exam ? ` Exam: ${exam}.` : ''} Make it structured and specific.`,
        mode:       'smart',
        session_id: S.sessionId,
      });
      plan = res.answer || res.response || '';
    }
    if (out) { out.textContent = plan; out.classList.remove('hidden'); }
  } catch (e) { alert('Planner failed: ' + e.message); }
  finally { setBtnLoading(btn, false); }
}

// ── MOCK ──────────────────────────────────────────────────────

function initMockModeControls() {
  const toggle = document.getElementById('mockModeToggle');
  toggle?.addEventListener('change', () => setMockMode(toggle.checked, 'manual'));
}

// ── HELPERS ───────────────────────────────────────────────────

function setBtnLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
  const l = btn.querySelector('.btn-loader');
  if (l) l.classList.toggle('hidden', !loading);
}
function setEl(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function escHtml(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }

// ── GLOBALS ───────────────────────────────────────────────────

window.nav                  = nav;
window.sendChat             = sendChat;
window.clearChat            = clearChat;
window.toggleVoice          = toggleVoice;
window.loadLectures         = loadLectures;
window.filterLectures       = filterLectures;
window.selectLecture        = selectLecture;
window.clearLecture         = clearLecture;
window.loadSessions         = loadSessions;
window.joinSession          = joinSession;
window.leaveSession         = leaveSession;
window.clearTranscript      = clearTranscript;
window.toggleTxScroll       = toggleTxScroll;
window.CONFIRM              = CONFIRM;
window.generateQuiz         = generateQuiz;
window.selectAnswer         = selectAnswer;
window.submitQuiz           = submitQuiz;
window.resetQuiz            = resetQuiz;
window.generateFlashcards   = generateFlashcards;
window.flipCard             = flipCard;
window.nextCard             = nextCard;
window.prevCard             = prevCard;
window.shuffleCards         = shuffleCards;
window.resetFlashcards      = resetFlashcards;
window.generateStudyPlan    = generateStudyPlan;
window.runConceptMap        = runConceptMap;
window.runDebate            = runDebate;
window.runEssay             = runEssay;
window.runSocratic          = runSocratic;
window.loadProgress         = loadProgress;
window.generatePlan         = generatePlan;
window.checkSystemStatus    = checkSystemStatus;
window.toggleSidebar        = () => { document.getElementById('sidebar')?.classList.toggle('open'); document.getElementById('sbOverlay')?.classList.toggle('open'); };
window.closeSidebar         = () => { document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sbOverlay')?.classList.remove('open'); };
window.populateAllLectureSelects = populateAllLectureSelects;