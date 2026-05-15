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
  quizAnswers:   {},
  studentId:     null,
};

// ── BOOT ──────────────────────────────────────────────────────

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
});

// ── SOCKET ────────────────────────────────────────────────────

function initSocket() {
  try {
    socketClient.connect(getApiBaseUrl(), Auth.getToken());
    socketClient.on('socket_connected',    () => FUI?.setStatus?.('sockDot', 'online'));
    socketClient.on('socket_disconnected', () => FUI?.setStatus?.('sockDot', 'error'));
  } catch (e) {
    console.warn('[student] socket init failed:', e.message);
  }
}

// ── SYSTEM STATUS ─────────────────────────────────────────────

async function checkSystemStatus() {
  FUI?.setStatus?.('llmDot', 'loading');
  try {
    if (isMockMode()) { FUI?.setStatus?.('llmDot', 'online'); return; }

    // [1] GET /health → { llm: bool, db: bool, status: "ok" }
    const res = await API.health();

    if (res?.llm) {       // bool — is_ready from Cell 6
      FUI?.setStatus?.('llmDot', 'online');
      FUI?.setTickerVal?.('tkLlm', 'ONLINE');
    } else {
      FUI?.setStatus?.('llmDot', 'loading');
      FUI?.setTickerVal?.('tkLlm', 'LOADING');
    }
  } catch {
    FUI?.setStatus?.('llmDot', 'error');
    FUI?.setTickerVal?.('tkLlm', 'ERROR');
    MockModeUI?.autoEnableOnFailure?.('Backend unreachable');
  }
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
  };
  const bc = document.getElementById('bcPage');
  if (bc) bc.textContent = labels[pageId] || pageId;

  if (pageId === 'library')  loadLectures();
  if (pageId === 'sessions') loadSessions();
  if (pageId === 'progress') loadProgress();
}

// ── CHAT ──────────────────────────────────────────────────────

async function sendChat() {
  const ta  = document.getElementById('chatInput');
  const btn = document.getElementById('sendBtn');
  const txt = ta?.value.trim();
  if (!txt) return;

  ta.value = '';
  ta.style.height = 'auto';
  appendMsg('user', txt);
  setBtnLoading(btn, true);

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
      mode:       S.chatMode,    // "auto","smart","rag","general","math","code"
      session_id: S.sessionId,
      lecture_id: S.lectureId || undefined,
    })) {
      const chunk = data.chunk || data.token || '';
      if (chunk) { appendChunk(el, chunk); got = true; }
    }

    if (!got) {
      // [2] Fallback: non-streaming /ask
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
    appendMsg('ai', '⚠ ' + (e.message || 'Request failed'));
  } finally {
    setBtnLoading(btn, false);
  }
}

// Chat DOM helpers
function appendMsg(role, text) {
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;
  const d = document.createElement('div');
  d.className = 'msg ' + role;
  d.innerHTML = `
    <div class="msg-av">${role === 'user' ? 'YOU' : 'AI'}</div>
    <div class="msg-content">
      <div class="msg-bub">${escHtml(text)}</div>
      <div class="msg-meta">${role === 'user' ? 'YOU' : 'ORIS'} · ${timestamp()}</div>
    </div>`;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function appendStreamEl() {
  const msgs = document.getElementById('chatMsgs');
  const d    = document.createElement('div');
  d.className = 'msg ai';
  d.innerHTML = `
    <div class="msg-av">AI</div>
    <div class="msg-content">
      <div class="msg-bub streaming" id="streamBub"></div>
      <div class="msg-meta" id="streamMeta">STREAMING…</div>
    </div>`;
  msgs?.appendChild(d);
  msgs && (msgs.scrollTop = msgs.scrollHeight);
  return d.querySelector('#streamBub');
}

function appendChunk(el, chunk) {
  if (!el) return;
  el.textContent += chunk;
  el.closest('.msg')?.parentElement && (el.closest('.msg').parentElement.scrollTop = el.closest('.msg').parentElement.scrollHeight);
}

function finaliseStream(el, meta) {
  el?.classList.remove('streaming');
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
    <button class="btn-ghost cs-btn" style="margin-top:.35rem;font-size:.58rem;color:var(--red)" onclick="clearLecture()">CLEAR CONTEXT</button>`;
  updateChatHint(); renderLectures(S.lectures);
  nav('chat');
}

function clearLecture() {
  S.lectureId = null; S.lectureTitle = null;
  const ctxDisplay = document.getElementById('ctxDisplay');
  if (ctxDisplay) ctxDisplay.innerHTML = '<span class="ctx-empty">No lecture selected</span>';
  updateChatHint();
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
let _txSegments = 0;
let _txWords    = 0;

function appendTxFinal(text, confidence, isSnapshot) {
  const waiting = document.getElementById('txWaiting');
  if (waiting) waiting.style.display = 'none';

  const content = document.getElementById('txContent');
  if (!content) return;

  const el = document.createElement('div');
  el.className = 'tx-segment';
  el.textContent = text;
  content.appendChild(el);
  content.scrollTop = content.scrollHeight;

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

function clearTranscript() {
  _txSegments = 0; _txWords = 0;
  const content  = document.getElementById('txContent');
  const interim  = document.getElementById('txInterim');
  const waiting  = document.getElementById('txWaiting');
  const wc       = document.getElementById('txWordCount');
  const segs     = document.getElementById('txSegs');
  if (content) content.innerHTML = '';
  if (interim) { interim.textContent = ''; interim.classList.add('hidden'); }
  if (waiting) waiting.style.display = '';
  if (wc)    wc.textContent    = '0 WORDS';
  if (segs)  segs.textContent  = '0';
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
  if (_studentWS) { try { _studentWS.close(); } catch {} _studentWS = null; }
  if (socketClient.connected) socketClient.leaveSession(S.liveSessionId, S.studentId);
  S.liveSessionId = null;

  const wrap = document.getElementById('sessActiveWrap');
  if (wrap) wrap.classList.add('hidden');
  clearTranscript();

  const sessCtx = document.getElementById('sessCtxDisplay');
  if (sessCtx) sessCtx.innerHTML = '<span class="ctx-empty">Not in session</span>';
}

// ── QUIZ ──────────────────────────────────────────────────────

function populateQuizLectures(lectures) {
  const sel = document.getElementById('quizLecSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— SELECT LECTURE —</option>';
  (lectures || S.lectures).forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id; opt.textContent = l.title || l.id;
    sel.appendChild(opt);
  });
}

async function generateQuiz() {
  const lecId = document.getElementById('quizLecSel')?.value;
  const num   = parseInt(document.getElementById('quizNumSel')?.value || '5');
  const diff  = document.getElementById('quizDiffSel')?.value || 'medium';

  if (!lecId) { alert('Please select a lecture'); return; }

  const btn = document.getElementById('genQuizBtn');
  setBtnLoading(btn, true);

  try {
    let questions;
    if (isMockMode()) {
      await sleep(800);
      questions = MockAPI?.getQuiz?.(num)?.questions || [];
    } else {
      // [6] POST /quiz/generate — Cell 9 QuizRequest schema
      const res = await API.post('/quiz/generate', {
        lecture_id:    lecId,
        num_questions: num,
        difficulty:    diff,
      });
      questions = res.questions || res;
    }

    S.quizData = questions; S.quizAnswers = {};
    renderQuiz(questions);

    document.getElementById('quizSetupWrap')?.classList.add('hidden');
    document.getElementById('quizWrap')?.classList.remove('hidden');
    document.getElementById('quizResult')?.classList.add('hidden');

  } catch (e) {
    alert('Quiz generation failed: ' + e.message);
  } finally {
    setBtnLoading(btn, false);
  }
}

function renderQuiz(questions) {
  const wrap = document.getElementById('quizContent');
  if (!wrap) return;
  wrap.innerHTML = questions.map((q, i) => `
    <div class="quiz-card" id="qc-${i}">
      <div class="quiz-card-num">QUESTION ${i+1} / ${questions.length}</div>
      <div class="quiz-card-q">${escHtml(q.question)}</div>
      <div class="quiz-opts" id="qopts-${i}">
        ${(q.options || []).map(opt => `
          <button class="quiz-opt" data-q="${i}" data-opt="${escHtml(opt)}"
                  onclick="selectAnswer(${i}, this)">
            ${escHtml(opt)}
          </button>`).join('')}
      </div>
    </div>`).join('');
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
  if (answered < total) { alert(`Answer all questions (${answered}/${total})`); return; }

  let correct = 0;
  S.quizData.forEach((q, i) => {
    const chosen  = S.quizAnswers[i];
    const isRight = chosen === q.correct;
    if (isRight) correct++;
    document.querySelectorAll(`#qopts-${i} .quiz-opt`).forEach(btn => {
      btn.disabled = true;
      if (btn.dataset.opt === q.correct)              btn.classList.add('correct');
      else if (btn.dataset.opt === chosen && !isRight) btn.classList.add('wrong');
    });
  });

  const pct = Math.round((correct / total) * 100);

  // [7] POST /quiz/submit — Cell 9 QuizSubmitRequest
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
    score:   pct,
    correct, total,
    date:    new Date().toLocaleDateString(),
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
      <span style="color:var(--text2);flex:1">${escHtml(h.lecture || '—')}</span>
      <span style="color:var(--text3);font-size:.65rem;margin-right:.75rem">${h.date || '—'}</span>
      <span style="color:${h.score >= 70 ? 'var(--green)' : h.score >= 50 ? 'var(--yellow)' : 'var(--red)'}">${h.score}%</span>
    </div>`).join('');
}

// ── PLANNER ───────────────────────────────────────────────────

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

window.nav               = nav;
window.sendChat          = sendChat;
window.clearChat         = clearChat;
window.toggleVoice       = toggleVoice;
window.loadLectures      = loadLectures;
window.filterLectures    = filterLectures;
window.selectLecture     = selectLecture;
window.clearLecture      = clearLecture;
window.loadSessions      = loadSessions;
window.joinSession       = joinSession;
window.leaveSession      = leaveSession;
window.generateQuiz      = generateQuiz;
window.selectAnswer      = selectAnswer;
window.submitQuiz        = submitQuiz;
window.resetQuiz         = resetQuiz;
window.loadProgress      = loadProgress;
window.generatePlan      = generatePlan;
window.checkSystemStatus = checkSystemStatus;
window.clearTranscript   = clearTranscript;
window.changeModel       = () => {};