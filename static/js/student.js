// ============================================================
// O.R.I.S. STUDENT DASHBOARD — js/student.js (v2.0)
// Fixed: nav(), clearChat, resetQuiz, quiz flow, voice, mock mode
// ============================================================

/* global api, Auth, CONFIG, socketClient, getApiBaseUrl, localStorage, Logger */

// ── State ──────────────────────────────────────────────────────
const State = {
  user:            null,
  lectures:        [],
  sessions:        [],
  currentPage:     'chat',
  chatMode:        'general',
  selectedLecture: null,
  sessionContext:  null,
  model:           'qwen2.5' // Default model
};

// ── Quiz private state ─────────────────────────────────────────
let _currentQuiz  = null;
let _quizAnswers  = {};

// ── Voice private state ────────────────────────────────────────
let _voiceActive = false;
let _recognition = null;

// ── Socket transcript handler (bound once) ─────────────────────
let _sessionTranscriptHandler = null;

// ── Helpers ────────────────────────────────────────────────────
const _tc = document.getElementById('toastCont');
function toast(msg, type = 'inf') {
  if (!_tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'success' ? 'ok' : type === 'error' ? 'err' : 'inf');
  t.textContent = msg;
  _tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity   = '0';
    t.style.transform = 'translateX(120%)';
    t.style.transition = '.3s';
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso || '—'; }
}

function dot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sdot ' + (state === 'ok' ? 'ok' : state === 'er' ? 'er' : 'ld');
}

// ── Navigation ─────────────────────────────────────────────────
const PAGE_LABELS = {
  chat: 'AI Assistant',
  library: 'Lecture Library',
  sessions: 'Live Sessions',
  quiz: 'Quizzes',
  progress: 'My Progress',
  planner: 'Study Planner',
};

function nav(page) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector(`[onclick="nav('${page}')"]`);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  const pg = document.getElementById('pg-' + page);
  if (pg) pg.classList.add('active');

  const bc = document.getElementById('bcPage');
  if (bc) bc.textContent = PAGE_LABELS[page] || page;
  State.currentPage = page;

  switch (page) {
    case 'chat':     updateChatUI(); break;
    case 'library':  loadLectures(); break;
    case 'sessions': loadSessions(); break;
    case 'quiz':     populateQuizDropdown(); break;
    case 'progress': loadProgress(); break;
  }
}

// ── Init ───────────────────────────────────────────────────────
async function initStudent() {
  const user = Auth.getUser();
  if (!user || user.role !== 'student') {
    window.location.href = './index.html';
    return;
  }
  State.user = user;

  const sbName = document.getElementById('sbName');
  const sbAv = document.getElementById('sbAv');
  if (sbName) sbName.textContent = user.username;
  if (sbAv) sbAv.textContent = Auth.initials();

  setLoadMsg('Loading lectures…');
  await loadLectures();

  setLoadMsg('Loading sessions…');
  await loadSessions();

  setLoadMsg('Checking system…');
  await checkSystemStatus();

  setupStudentEvents();

  setLoadMsg('Ready!');
  setTimeout(() => {
    const loadOv = document.getElementById('loadOv');
    if (loadOv) loadOv.classList.add('hidden');
  }, 500);
}

function setLoadMsg(m) {
  const el = document.getElementById('loadMsg');
  if (el) el.textContent = m;
}

// ── CHAT ───────────────────────────────────────────────────────
function clearChat() {
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;
  msgs.innerHTML = `
    <div class="msg ai">
      <div class="msg-av">AI</div>
      <div><div class="msg-bub">
        Chat cleared. I'm your O.R.I.S. AI assistant powered by
        <strong style="color:var(--cyan)">Qwen 2.5</strong>.
        Select a lecture for RAG-powered answers, or ask me anything! 🎓
      </div></div>
    </div>`;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = (input?.value || '').trim();
  if (!msg) return;

  const sendBtn = document.getElementById('sendBtn');
  const btnText = sendBtn?.querySelector('.btn-text');
  const btnLoader = sendBtn?.querySelector('.btn-loader');

  if (sendBtn) sendBtn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');

  addChatMessage('user', msg);
  if (input) {
    input.value = '';
    input.style.height = 'auto';
  }

  const placeholderEl = addChatMessage('ai', '');

  const payload = {
    message:    msg,
    mode:       State.chatMode,
    lecture_id: State.selectedLecture?.id || null,
    session_id: State.sessionContext
      ? (State.sessionContext.id || State.sessionContext.session_id)
      : null,
  };

  let accumulated = '';
  const bub = placeholderEl?.querySelector('.msg-bub');
  if (bub) bub.classList.add('streaming');

  await api.askStream(
    payload,
    chunk => {
      accumulated += chunk;
      if (bub) bub.textContent = accumulated;
      const msgs = document.getElementById('chatMsgs');
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
    },
    () => {
      if (bub) bub.classList.remove('streaming');
      if (sendBtn) sendBtn.disabled = false;
      if (btnText) btnText.classList.remove('hidden');
      if (btnLoader) btnLoader.classList.add('hidden');
    },
    err => {
      if (bub) {
        bub.classList.remove('streaming');
        bub.textContent = '⚠ Could not get a response. Check your backend connection.';
        bub.style.color = 'var(--magenta)';
      }
      if (sendBtn) sendBtn.disabled = false;
      if (btnText) btnText.classList.remove('hidden');
      if (btnLoader) btnLoader.classList.add('hidden');
      console.error('Chat error:', err);
    }
  );
}

function addChatMessage(type, content) {
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return document.createElement('div');
  const av = type === 'ai'
    ? 'AI'
    : (State.user?.username?.[0] || 'U').toUpperCase();

  const div = document.createElement('div');
  div.className = 'msg ' + type;
  div.innerHTML = `
    <div class="msg-av">${escHtml(av)}</div>
    <div><div class="msg-bub">${escHtml(content)}</div></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function setChatMode(mode) {
  State.chatMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.remove('active');
    b.classList.remove('mode-active');
  });
  const activeBtn = document.querySelector(`[data-mode="${mode}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.classList.add('mode-active');
    // Add click animation to the active mode button
    activeBtn.style.transform = 'scale(1.05)';
    setTimeout(() => {
      activeBtn.style.transform = '';
    }, 150);
  }
  const modeLbl = document.getElementById('modeLbl');
  if (modeLbl) modeLbl.textContent = mode;
  
  // Also update the mode label with a subtle animation
  if (modeLbl) {
    modeLbl.style.opacity = '0.7';
    setTimeout(() => {
      modeLbl.style.opacity = '';
    }, 300);
  }
}

function selectLectureForChat(lectureId) {
  State.selectedLecture = State.lectures.find(l => l.id === lectureId) || null;
  updateChatUI();
  nav('chat');
  toast(State.selectedLecture ? `Context set: ${State.selectedLecture.title}` : 'Context cleared', 'inf');
}

function updateChatUI() {
  const ctxDisplay = document.getElementById('ctxDisplay');
  const ctxLbl     = document.getElementById('ctxLbl');
  if (!ctxDisplay) return;

  if (State.selectedLecture) {
    ctxDisplay.innerHTML = `
      <div class="ctx-pill">
        <span class="ctx-title">${escHtml(State.selectedLecture.title)}</span>
        <span class="rm" onclick="clearLectureContext()" title="Remove context">✕</span>
      </div>`;
    if (ctxLbl) ctxLbl.textContent = 'selected';
    // Pulse the lecture context pill
    const lecturePill = ctxDisplay.querySelector('.ctx-pill');
    if (lecturePill) {
      lecturePill.classList.add('pulse');
      setTimeout(() => lecturePill.classList.remove('pulse'), 500);
    }
  } else {
    ctxDisplay.innerHTML = `<span style="font-family:var(--fm);font-size:.68rem;color:var(--text3)">No lecture selected</span>`;
    if (ctxLbl) ctxLbl.textContent = 'none';
  }

  const sessDisplay = document.getElementById('sessCtxDisplay');
  if (sessDisplay) {
    if (State.sessionContext) {
      const sessTitle = State.sessionContext.title || State.sessionContext.id || 'Live session';
      sessDisplay.innerHTML = `
        <div class="ctx-pill">
          <span class="ctx-title">${escHtml(sessTitle)}</span>
        </div>`;
      // Pulse the session context pill
      const sessionPill = sessDisplay.querySelector('.ctx-pill');
      if (sessionPill) {
        sessionPill.classList.add('pulse');
        setTimeout(() => sessionPill.classList.remove('pulse'), 500);
      }
    } else {
      sessDisplay.innerHTML = '<span style="font-family:var(--fm);font-size:.68rem;color:var(--text3)">Not in session</span>';
    }
  }
}

// Update model display when model changes
function changeModel(modelValue) {
  // Store the selected model in State for potential use with the backend
  State.model = modelValue;
  
  // Update the modelLabel to show the selected model
  const modelLabel = document.getElementById('modelLabel');
  if (modelLabel) {
    modelLabel.textContent = modelValue.toUpperCase();
  }
  
  // Update the modelDot status indicator to show loading state
  const modelDot = document.getElementById('modelDot');
  if (modelDot) {
    modelDot.className = 'sdot ld'; // Set to loading state initially
  }
  
  // Simulate a brief loading delay then update the status dot to show success
  setTimeout(() => {
    if (modelDot) {
      modelDot.className = 'sdot ok';
    }
    
    // TODO: Actually implement model switching with backend
    // For now, just show a toast
    toast(`Model changed to ${modelValue}`, 'inf');
  }, 1000);
}

function clearLectureContext() {
  State.selectedLecture = null;
  updateChatUI();
}

// ── LECTURE LIBRARY ────────────────────────────────────────────
async function loadLectures() {
  try {
    State.lectures = await api.getLectures();
    renderLectures(State.lectures);
  } catch (e) {
    const grid = document.getElementById('lecGrid');
    if (grid) grid.innerHTML = '<div class="empty"><span class="empty-ico">⚠</span>Failed to load lectures. Check backend connection.</div>';
    console.error('loadLectures:', e);
  }
}

function renderLectures(lectures) {
  const grid = document.getElementById('lecGrid');
  if (!grid) return;

  if (!lectures || !lectures.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-ico">📚</span>No lectures available yet.</div>';
    return;
  }

  const badgeMap = { pdf: 'b-pdf', docx: 'b-docx', pptx: 'b-pptx', txt: 'b-text', md: 'b-text' };

  grid.innerHTML = lectures.map(lec => {
    const bc  = badgeMap[lec.file_type] || 'b-text';
    const isCtx = State.selectedLecture?.id === lec.id;
    return `
      <div class="glass lec-card${isCtx ? ' actx' : ''}">
        <span class="lec-badge ${bc}">${(lec.file_type || 'doc').toUpperCase()}</span>
        <div class="lec-title">${escHtml(lec.title)}</div>
        <div class="lec-meta">${formatDate(lec.created_at)}</div>
        <div class="lec-actions" style="margin-top:.9rem;display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="btn-ghost" style="font-size:.65rem" onclick="selectLectureForChat('${lec.id}')">
            ${isCtx ? '✓ Active Context' : 'Set as Context'}
          </button>
          <button class="btn sm mag" onclick="generateQuiz('${lec.id}')">✍ Quiz</button>
        </div>
      </div>`;
  }).join('');
}

function filterLectures() {
  const q = (document.getElementById('libSearch')?.value || '').toLowerCase();
  renderLectures(State.lectures.filter(l => l.title.toLowerCase().includes(q)));
}

// ── QUIZ ───────────────────────────────────────────────────────
function populateQuizDropdown() {
  const sel = document.getElementById('quizLecSel');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— choose lecture —</option>';
  State.lectures.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.title;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

async function generateQuiz(lectureIdArg) {
  if (lectureIdArg) {
    nav('quiz');
    const sel = document.getElementById('quizLecSel');
    if (sel) sel.value = lectureIdArg;
  }

  const lecId = document.getElementById('quizLecSel')?.value;
  if (!lecId) { toast('Select a lecture first', 'error'); return; }

  const num  = parseInt(document.getElementById('quizNumSel')?.value || '5');
  const diff = document.getElementById('quizDiffSel')?.value || 'medium';

  const btn = document.getElementById('genQuizBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoader = btn?.querySelector('.btn-loader');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');

  try {
    const res = await api.generateQuiz(lecId, num, diff);
    _currentQuiz  = res;
    _quizAnswers  = {};

    renderQuizQuestions(res.questions);

    document.getElementById('quizSetupWrap')?.classList.add('hidden');
    document.getElementById('quizWrap')?.classList.remove('hidden');
    document.getElementById('quizResult')?.classList.add('hidden');

    const submitBtn = document.getElementById('submitQuizBtn');
    if (submitBtn) submitBtn.disabled = false;

    toast(`${res.questions.length} questions ready!`, 'success');
  } catch (e) {
    toast(e.message || 'Quiz generation failed', 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
  }
}

const _LETTERS = ['A', 'B', 'C', 'D'];

function renderQuizQuestions(questions) {
  const container = document.getElementById('quizContent');
  if (!container) return;

  container.innerHTML = questions.map((q, qi) => `
    <div class="glass quiz-q" id="qq-${qi}">
      <div class="q-num">Question ${qi + 1} of ${questions.length}</div>
      <div class="q-text">${escHtml(q.question)}</div>
      <div class="opts" id="opts-${qi}">
        ${q.options.map((opt, oi) => `
          <button class="opt" id="opt-${qi}-${oi}" onclick="selectAnswer(${qi},${oi})">
            <span class="opt-letter">${_LETTERS[oi]}</span>
            ${escHtml(opt)}
          </button>`).join('')}
      </div>
      <div class="quiz-exp" id="exp-${qi}">${escHtml(q.explanation || '')}</div>
    </div>`).join('');
}

function selectAnswer(qIdx, optIdx) {
  if (!_currentQuiz) return;
  _quizAnswers[qIdx] = optIdx;

  const numOpts = _currentQuiz.questions[qIdx]?.options?.length || 4;
  for (let i = 0; i < numOpts; i++) {
    const btn = document.getElementById(`opt-${qIdx}-${i}`);
    if (btn) btn.classList.toggle('sel', i === optIdx);
  }
}

async function submitQuiz() {
  if (!_currentQuiz) return;

  const questions = _currentQuiz.questions;
  const answers   = questions.map((_, i) => (_quizAnswers[i] !== undefined ? _quizAnswers[i] : -1));
  const unanswered = answers.filter(a => a === -1).length;

  if (unanswered > 0 && !confirm(`${unanswered} question(s) unanswered — submit anyway?`)) return;

  // Reveal correct / wrong
  questions.forEach((q, qi) => {
    const userAns = answers[qi];
    q.options.forEach((_, oi) => {
      const btn = document.getElementById(`opt-${qi}-${oi}`);
      if (!btn) return;
      btn.disabled = true;
      if (oi === q.correct) btn.classList.add('corr');
      else if (oi === userAns && userAns !== q.correct) btn.classList.add('wrong');
    });
    document.getElementById(`exp-${qi}`)?.classList.add('show');
  });

  const correct = questions.filter((q, i) => answers[i] === q.correct).length;
  const score   = Math.round((correct / questions.length) * 100);

  // Persist to backend
  try {
    await api.submitQuiz(_currentQuiz.lecture_id, questions, answers, _currentQuiz.difficulty);
  } catch (e) {
    console.warn('Failed to persist quiz result:', e);
  }

  // Save to localStorage
  const hist = JSON.parse(localStorage.getItem(CONFIG.QUIZ_HISTORY_KEY) || '[]');
  hist.unshift({
    ts:         Date.now(),
    score,
    correct,
    total:      questions.length,
    difficulty: _currentQuiz.difficulty,
    lectureId:  _currentQuiz.lecture_id,
  });
  localStorage.setItem(CONFIG.QUIZ_HISTORY_KEY, JSON.stringify(hist.slice(0, 50)));

  const submitBtn = document.getElementById('submitQuizBtn');
  if (submitBtn) submitBtn.disabled = true;

  setTimeout(() => {
    document.getElementById('quizWrap')?.classList.add('hidden');

    const scoreEl  = document.getElementById('qScoreVal');
    const detailEl = document.getElementById('qScoreDetail');
    const resultEl = document.getElementById('quizResult');

    if (scoreEl)  scoreEl.textContent  = `${score}%`;
    if (detailEl) detailEl.textContent =
      `${correct} of ${questions.length} correct · ${_currentQuiz.difficulty} difficulty`;
    if (resultEl) resultEl.classList.remove('hidden');

    if (scoreEl) {
      scoreEl.style.color = score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--magenta)';
    }
  }, 600);
}

function resetQuiz() {
  _currentQuiz = null;
  _quizAnswers = {};

  const content   = document.getElementById('quizContent');
  const wrap      = document.getElementById('quizWrap');
  const result    = document.getElementById('quizResult');
  const setup     = document.getElementById('quizSetupWrap');
  const submitBtn = document.getElementById('submitQuizBtn');

  if (content)   content.innerHTML  = '';
  if (wrap)      wrap.classList.add('hidden');
  if (result)    result.classList.add('hidden');
  if (setup)     setup.classList.remove('hidden');
  if (submitBtn) submitBtn.disabled = false;
}

// ── LIVE SESSIONS ──────────────────────────────────────────────
async function loadSessions() {
  try {
    State.sessions = await api.getSessions();
    renderSessions(State.sessions);
  } catch (e) {
    const list = document.getElementById('sessListSt');
    if (list) list.innerHTML = '<div class="empty">Failed to load sessions.</div>';
    console.error('loadSessions:', e);
  }
}

function renderSessions(sessions) {
  const list = document.getElementById('sessListSt');
  if (!list) return;

  if (!sessions || !sessions.length) {
    list.innerHTML = '<div class="empty"><span class="empty-ico">🎙</span>No active sessions right now.</div>';
    return;
  }

  list.innerHTML = sessions.map(sess => {
    const sid     = sess?.id || sess?.session_id || '';
    const title   = escHtml(sess?.title || 'Live Session');
    const created = sess?.created_at ? formatDate(sess.created_at) : '';
    const isJoined = State.sessionContext &&
      (State.sessionContext.id === sid || State.sessionContext.session_id === sid);
    return `
      <div class="glass sess-card">
        <div class="live-dot"></div>
        <div class="sess-info">
          <div class="sess-title">${title}</div>
          <div class="sess-id">${sid.substring(0, 16)}…${created ? ` · ${created}` : ''}</div>
        </div>
        <div class="sess-acts">
          ${isJoined
            ? '<button class="btn mag sm" onclick="leaveSession()">Leave</button>'
            : `<button class="btn grn sm" onclick="joinSession('${sid}')">Join</button>`}
        </div>
      </div>`;
  }).join('');
}

async function joinSession(sessionId) {
  const sess = State.sessions.find(s => (s.id || s.session_id) === sessionId);
  State.sessionContext = sess || { id: sessionId, session_id: sessionId };

  let base = '';
  try { base = getApiBaseUrl(); } catch { toast('Backend URL not set', 'error'); return; }

  try {
    socketClient.connect(base, api.getToken());
  } catch (e) {
    toast(e?.message || 'Socket connection failed', 'error');
    return;
  }

  if (!_sessionTranscriptHandler) {
    _sessionTranscriptHandler = data => {
      if (!State.sessionContext) return;
      const panel = document.getElementById('transcriptPanel');
      if (!panel) return;
      panel.querySelector('.tx-empty')?.remove();

      const entry = document.createElement('div');
      entry.className = 'tx-entry';
      const speaker = String(data?.speaker || 'Unknown');
      const text    = String(data?.text || '');
      let ts = '';
      try {
        if (typeof data?.timestamp === 'number')
          ts = new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      } catch {}
      entry.innerHTML = `
        <span class="tx-sp ${escHtml(speaker)}">${escHtml(speaker)}</span>
        <span class="tx-text"></span>
        <span class="tx-time">${ts}</span>`;
      entry.querySelector('.tx-text').textContent = text;
      panel.appendChild(entry);
      panel.scrollTop = panel.scrollHeight;
    };
    socketClient.on('transcript', _sessionTranscriptHandler);
  }

  socketClient.joinSession(sessionId);

  document.getElementById('sessTranscriptWrap')?.classList.remove('hidden');
  const txSessionId = document.getElementById('txSessionId');
  if (txSessionId) txSessionId.textContent = State.sessionContext.title || sessionId;

  updateChatUI();
  renderSessions(State.sessions);
  toast(`Joined: ${State.sessionContext.title || sessionId}`, 'success');
}

function leaveSession() {
  State.sessionContext = null;
  document.getElementById('sessTranscriptWrap')?.classList.add('hidden');
  const panel = document.getElementById('transcriptPanel');
  if (panel) panel.innerHTML = '<div class="tx-empty">Waiting for transcript…</div>';
  updateChatUI();
  renderSessions(State.sessions);
  toast('Left session', 'inf');
}

// ── PROGRESS ───────────────────────────────────────────────────
function loadProgress() {
  const hist = JSON.parse(localStorage.getItem(CONFIG.QUIZ_HISTORY_KEY) || '[]');

  const taken = document.getElementById('pQuizTaken');
  const avg   = document.getElementById('pAvgScore');
  const best  = document.getElementById('pBestScore');
  const lec   = document.getElementById('pLecViewed');

  if (taken) taken.textContent = hist.length;
  if (lec)   lec.textContent  = State.lectures.length;

  if (hist.length) {
    const scores = hist.map(h => h.score);
    const avgVal  = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const bestVal = Math.max(...scores);
    if (avg)  avg.textContent  = `${avgVal}%`;
    if (best) best.textContent = `${bestVal}%`;
  } else {
    if (avg) avg.textContent = '0%';
    if (best) best.textContent = '0%';
  }
}

  const histEl = document.getElementById('scoreHistory');
  if (histEl) {
    if (!hist.length) {
      histEl.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">Take a quiz to see history here.</span>';
    } else {
      histEl.innerHTML = hist.slice(0, 10).map(h => {
        const date   = new Date(h.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const colour = h.score >= 70 ? 'var(--green)' : h.score >= 50 ? 'var(--yellow)' : 'var(--magenta)';
        return `
          <div class="prog-bar-row">
            <span class="prog-bar-label">${date}</span>
            <div class="prog-bar-track">
              <div class="prog-bar-fill" style="width:${h.score}%;background:${colour}"></div>
            </div>
            <span class="prog-bar-val" style="color:${colour}">${h.score}%</span>
          </div>`;
      }).join('');
    }
  }

  const topicEl = document.getElementById('topicPerf');
  if (topicEl) {
    if (!hist.length) {
      topicEl.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">Complete quizzes to unlock topic analysis.</span>';
    } else {
      const byLec = {};
      hist.forEach(h => {
        const lid = h.lectureId || 'unknown';
        if (!byLec[lid]) byLec[lid] = [];
        byLec[lid].push(h.score);
      });
      topicEl.innerHTML = Object.entries(byLec).map(([lid, scores]) => {
        const lecTitle = State.lectures.find(l => l.id === lid)?.title || lid;
        const lecAvg   = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        const colour   = lecAvg >= 70 ? 'var(--green)' : lecAvg >= 50 ? 'var(--yellow)' : 'var(--magenta)';
        return `
          <div class="prog-bar-row">
            <span class="prog-bar-label" title="${escHtml(lecTitle)}"
              style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${escHtml(lecTitle.substring(0, 18))}
            </span>
            <div class="prog-bar-track">
              <div class="prog-bar-fill" style="width:${lecAvg}%;background:${colour}"></div>
            </div>
            <span class="prog-bar-val" style="color:${colour}">${lecAvg}%</span>
          </div>`;
      }).join('');
    }
  }
}

// ── STUDY PLANNER ──────────────────────────────────────────────
async function generatePlan() {
  const topics   = (document.getElementById('planTopics')?.value || '').trim();
  const hours    = document.getElementById('planHours')?.value    || '2';
  const duration = document.getElementById('planDuration')?.value || '2 weeks';

  if (!topics) { toast('Enter some topics to study', 'error'); return; }

  const btn = document.getElementById('planBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoader = btn?.querySelector('.btn-loader');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');

  const planOutput = document.getElementById('planOutput');
  const planText   = document.getElementById('planText');
  if (planOutput) planOutput.classList.remove('hidden');
  if (planText)   { planText.textContent = ''; planText.classList.add('streaming'); }

  const payload = {
    message: `Create a detailed, structured ${duration} study plan for these topics: ${topics}. I can study ${hours} hours per day. Include daily goals, key concepts to master, and suggested exercises or practice methods.`,
    mode:    'study_planner',
  };

  await api.askStream(
    payload,
    chunk => { if (planText) planText.textContent += chunk; },
    ()    => {
      if (planText) planText.classList.remove('streaming');
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
      }
      toast('Study plan generated!', 'success');
    },
    err => {
      if (planText) {
        planText.classList.remove('streaming');
        planText.textContent = `⚠ Could not generate plan: ${err?.message || 'Check backend connection.'}`;
      }
      if (btn) {
        btn.disabled = false;
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
      }
      toast('Plan generation failed', 'error');
    }
  );
}

// ── SYSTEM STATUS ──────────────────────────────────────────────
async function checkSystemStatus() {
  try {
    const h = await api.health();
    dot('llmDot',  h.llm ? 'ok' : 'ld');
    dot('sockDot', socketClient.connected ? 'ok' : 'er');
    const llmLbl = document.getElementById('llmLbl');
    if (llmLbl) llmLbl.textContent = h.llm ? 'LLM ✓' : 'LLM…';
  } catch {
    dot('llmDot',  'er');
    dot('sockDot', 'er');
  }
}

// ── VOICE INPUT ────────────────────────────────────────────────
function toggleVoice() {
  const btn = document.getElementById('voiceBtn');

  if (_voiceActive && _recognition) {
    try { _recognition.stop(); } catch {}
    _voiceActive = false;
    if (btn) btn.classList.remove('listening');
    return;
  }

  try {
    _recognition = socketClient.createSpeechRecognizer(
      (text, isFinal) => {
        const input = document.getElementById('chatInput');
        if (!input) return;
        input.value = text;
        if (isFinal) {
          sendChat();
          input.value = '';
        }
      },
      () => {
        _voiceActive = false;
        if (btn) btn.classList.remove('listening');
      }
    );
    _recognition.start();
    _voiceActive = true;
    if (btn) btn.classList.add('listening');
    toast('Listening… speak now', 'inf');
  } catch (e) {
    toast(e?.message || 'Voice not supported in this browser', 'error');
  }
}

function showQuickPrompts() {
  // Create a modal container for quick prompts
  const modal = document.createElement('div');
  modal.className = 'quick-prompts-modal glass';
  modal.style.position = 'fixed';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.width = '90%';
  modal.style.maxWidth = '400px';
  modal.style.maxHeight = '80vh';
  modal.style.zIndex = '1001';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.gap = '1rem';
  modal.style.padding = '1.5rem';
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn-icon';
  closeBtn.innerHTML = '✕';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '1rem';
  closeBtn.style.right = '1rem';
  closeBtn.onclick = () => modal.remove();
  
  // Title
  const title = document.createElement('div');
  title.className = 'lbl';
  title.textContent = 'Quick Prompts';
  
  // Prompts container
  const promptsContainer = document.createElement('div');
  promptsContainer.style.display = 'flex';
  promptsContainer.style.flexDirection = 'column';
  promptsContainer.style.gap = '0.75rem';
  
  // Sample quick prompts
  const samplePrompts = [
    { text: 'Explain the main concept', icon: '💡' },
    { text: 'Give me an example', icon: '📝' },
    { text: 'How does this work?', icon: '🔧' },
    { text: 'What are the key points?', icon: '🎯' },
    { text: 'Summarize this topic', icon: '📋' },
    { text: 'Why is this important?', icon: '❓' }
  ];
  
  samplePrompts.forEach(prompt => {
    const btn = document.createElement('button');
    btn.className = 'btn-ghost';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '0.5rem';
    btn.innerHTML = `<span>${prompt.icon}</span><span>${prompt.text}</span>`;
    btn.onclick = () => {
      const input = document.getElementById('chatInput');
      if (input) {
        input.value = prompt.text;
        input.focus();
        // Send chat after a short delay to allow user to see the prompt
        setTimeout(() => sendChat(), 100);
      }
      modal.remove();
    };
    promptsContainer.appendChild(btn);
  });
  
  // Assemble modal
  modal.appendChild(closeBtn);
  modal.appendChild(title);
  modal.appendChild(promptsContainer);
  
  // Add to document
  document.body.appendChild(modal);
}

// ── EVENTS ─────────────────────────────────────────────────────
function setupStudentEvents() {
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    chatInput.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 110) + 'px';
    });
  }

  const modeGrid = document.getElementById('modeGrid');
  if (modeGrid) {
    modeGrid.addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn');
      if (btn?.dataset.mode) setChatMode(btn.dataset.mode);
    });
  }

  const libSearch = document.getElementById('libSearch');
  if (libSearch) libSearch.addEventListener('input', filterLectures);

  const voiceBtn = document.getElementById('voiceBtn');
  if (voiceBtn) voiceBtn.addEventListener('click', toggleVoice);
}

// ── BOOTSTRAP ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  try {
    Logger?.setContext({ page: 'student', user: Auth.getUser()?.username, role: Auth.getUser()?.role });
  } catch {}
  if (!Auth.isLoggedIn()) {
    window.location.href = './index.html';
    return;
  }
  initStudent();
});
