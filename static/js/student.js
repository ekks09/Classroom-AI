/**
 * O.R.I.S. Student Dashboard
 */

const State = {
  user: null,
  lectures: [],
  sessions: [],
  currentPage: 'chat',
  chatMode: 'general',
  selectedLecture: null,
  sessionContext: null,
};

let _sessionTranscriptHandler = null;

/* ── Toast shortcut (same style as teacher) ───────────────── */
const _tc = document.getElementById('toastCont');
function toast(msg, type = 'inf') {
  if (!_tc) return;
  const t = document.createElement('div');
  t.className = `toast ${type === 'success' ? 'ok' : type === 'error' ? 'err' : 'inf'}`;
  t.textContent = msg;
  _tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateX(120%)';
    t.style.transition = '.3s';
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

// ── INIT ──────────────────────────────────────────────────────
async function initStudent() {
  const user = Auth.getUser();
  if (!user || user.role !== 'student') {
    window.location.href = './index.html';
    return;
  }
  State.user = user;

  // Update UI
  document.getElementById('sbName').textContent = user.username;
  document.getElementById('sbAv').textContent = Auth.initials();

  // Load initial data
  await loadLectures();
  await loadSessions();
  checkSystemStatus();

  // Setup events
  setupStudentEvents();
}

// ── NAVIGATION ────────────────────────────────────────────────
function nav(page) {
  // Update active nav
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[onclick="nav('${page}')"]`).classList.add('active');

  // Show page
  document.querySelectorAll('.pg').forEach(pg => pg.classList.remove('active'));
  document.getElementById(`pg-${page}`).classList.add('active');

  // Update breadcrumb
  document.getElementById('bcPage').textContent = page.charAt(0).toUpperCase() + page.slice(1);

  State.currentPage = page;

  // Load page data
  switch (page) {
    case 'chat': updateChatUI(); break;
    case 'library': loadLectures(); break;
    case 'sessions': loadSessions(); break;
    case 'quiz': /* handled separately */ break;
    case 'progress': loadProgress(); break;
    case 'planner': /* TODO */ break;
  }
}

// ── CHAT SYSTEM ───────────────────────────────────────────────
async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;

  addChatMessage('user', msg);
  input.value = '';

  const payload = {
    message: msg,
    mode: State.chatMode,
    lecture_id: State.selectedLecture?.id,
    session_id: State.sessionContext ? (State.sessionContext.id || State.sessionContext.session_id) : null,
  };

  let aiMsg = '';
  addChatMessage('ai', ''); // Placeholder

  try {
    await api.askStream(payload,
      (chunk) => {
        aiMsg += chunk;
        updateLastAIMessage(aiMsg);
      },
      () => {
        // Done
      },
      (error) => {
        updateLastAIMessage('Error: Could not get response. Please try again.');
        console.error('Chat error:', error);
      }
    );
  } catch (e) {
    updateLastAIMessage('Error: Could not get response. Please try again.');
    console.error('Chat error:', e);
  }
}

function updateLastAIMessage(content) {
  const msgs = document.getElementById('chatMsgs');
  const lastMsg = msgs.lastElementChild;
  if (lastMsg && lastMsg.classList.contains('ai')) {
    lastMsg.querySelector('.msg-bub').textContent = content;
    msgs.scrollTop = msgs.scrollHeight;
  }
}

function addChatMessage(type, content) {
  const msgs = document.getElementById('chatMsgs');
  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${type}`;
  msgDiv.innerHTML = `
    <div class="msg-av">${type === 'ai' ? 'AI' : State.user.username[0].toUpperCase()}</div>
    <div><div class="msg-bub">${content}</div></div>
  `;
  msgs.appendChild(msgDiv);
  msgs.scrollTop = msgs.scrollHeight;
}

function setChatMode(mode) {
  State.chatMode = mode;
  document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelector(`[data-mode="${mode}"]`).classList.add('active');
  document.getElementById('modeLbl').textContent = mode;
}

function selectLectureForChat(lectureId) {
  State.selectedLecture = State.lectures.find(l => l.id === lectureId);
  updateChatUI();
}

function updateChatUI() {
  const ctx = State.selectedLecture ? State.selectedLecture.title : 'No lecture selected';
  document.getElementById('ctxDisplay').innerHTML = `<span style="font-family:var(--fm);font-size:.68rem;color:var(--text3)">${ctx}</span>`;
  document.getElementById('ctxLbl').textContent = State.selectedLecture ? 'selected' : 'none';
}

// ── LECTURE LIBRARY ───────────────────────────────────────────
async function loadLectures() {
  try {
    const lectures = await api.getLectures();
    State.lectures = lectures;
    renderLectures(lectures);
  } catch (e) {
    document.getElementById('lecGrid').innerHTML = '<div class="empty"><span class="empty-ico">📚</span>Failed to load lectures</div>';
    console.error('Load lectures error:', e);
  }
}

function renderLectures(lectures) {
  const grid = document.getElementById('lecGrid');
  if (!lectures.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-ico">📚</span>No lectures yet</div>';
    return;
  }

  grid.innerHTML = lectures.map(lec => `
    <div class="lec-card glass">
      <div class="lec-hdr">
        <div class="lec-title">${lec.title}</div>
        <div class="lec-meta">${lec.file_type.toUpperCase()} · ${new Date(lec.created_at).toLocaleDateString()}</div>
      </div>
      <div class="lec-acts">
        <button class="btn-ghost sm" onclick="selectLectureForChat('${lec.id}')">Set as Context</button>
        <button class="btn sm" onclick="openLecture('${lec.id}')">Study</button>
        <button class="btn mag sm" onclick="generateQuiz('${lec.id}')">Quiz</button>
      </div>
    </div>
  `).join('');
}

function filterLectures() {
  const q = document.getElementById('libSearch').value.toLowerCase();
  const filtered = State.lectures.filter(l => l.title.toLowerCase().includes(q));
  renderLectures(filtered);
}

function openLecture(id) {
  // TODO: Open lecture viewer
  toast('Lecture viewer coming soon!', 'info');
}

// ── QUIZZES ───────────────────────────────────────────────────
let currentQuiz = null;

async function generateQuiz(lectureId) {
  nav('quiz');
  try {
    currentQuiz = await api.generateQuiz(lectureId, 5, 'medium');
    renderQuiz(currentQuiz);
  } catch (e) {
    toast('Failed to generate quiz', 'error');
    console.error('Quiz gen error:', e);
  }
}

function renderQuiz(quiz) {
  const container = document.getElementById('pg-quiz');
  container.innerHTML = `
    <div class="pg-hdr">
      <div><div class="pg-title">Quiz</div><div class="pg-desc">Test your knowledge</div></div>
    </div>
    <div class="quiz-form glass">
      ${quiz.questions.map((q, i) => `
        <div class="q-item">
          <div class="q-text">${i+1}. ${q.question}</div>
          <div class="q-opts">
            ${q.options.map((opt, j) => `
              <label class="q-opt">
                <input type="radio" name="q${i}" value="${j}">
                <span>${String.fromCharCode(65+j)}. ${opt}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `).join('')}
      <div class="q-submit">
        <button class="btn full" onclick="submitQuiz()">Submit Quiz</button>
      </div>
    </div>
  `;
}

async function submitQuiz() {
  const answers = [];
  document.querySelectorAll('.q-item').forEach((item, i) => {
    const checked = item.querySelector('input:checked');
    answers.push(checked ? parseInt(checked.value) : -1);
  });

  try {
    const res = await api.submitQuiz(currentQuiz.lecture_id, currentQuiz.questions, answers, 'medium');
    toast(`Quiz completed! Score: ${res.score}%`, 'success');
    nav('progress');
  } catch (e) {
    toast('Failed to submit quiz', 'error');
    console.error('Quiz submit error:', e);
  }
}

// ── LIVE SESSIONS ─────────────────────────────────────────────
async function loadSessions() {
  try {
    const sessions = await api.getSessions();
    State.sessions = sessions;
    renderSessions(sessions);
  } catch (e) {
    document.getElementById('sessListSt').innerHTML = '<p class="text-secondary">Failed to load sessions</p>';
    console.error('Load sessions error:', e);
  }
}

function renderSessions(sessions) {
  const list = document.getElementById('sessListSt');
  if (!sessions.length) {
    list.innerHTML = '<div class="empty">No active sessions</div>';
    return;
  }

  list.innerHTML = sessions.map(sess => {
    // Backend shape: { id, title, teacher_id, created_at }
    // Mock shape:    { session_id, id, title, status }
    const sid = sess?.id || sess?.session_id || '';
    const title = sess?.title || 'Live Session';
    const created = sess?.created_at ? new Date(sess.created_at).toLocaleString() : '';
    return `
    <div class="sess-card glass">
      <div class="live-dot"></div>
      <div class="sess-info">
        <div class="sess-title">${title}</div>
        <div class="sess-id">${sid}${created ? ` · ${created}` : ''}</div>
      </div>
      <div class="sess-acts">
        <button class="btn grn sm" onclick="joinSession('${sid}')">Join</button>
      </div>
    </div>
  `;
  }).join('');
}

async function joinSession(sessionId) {
  State.sessionContext = State.sessions.find(s => (s.id || s.session_id) === sessionId) || { id: sessionId };

  // Ensure socket connected with JWT in auth payload (backend expects auth.token)
  try {
    socketClient.connect(getApiBaseUrl(), api.getToken());
  } catch (e) {
    toast(e?.message || 'Socket URL not configured', 'error');
    return;
  }

  // Bind transcript handler once, and render only while in-session
  if (!_sessionTranscriptHandler) {
    _sessionTranscriptHandler = (data) => {
      if (!State.sessionContext) return;
      const panel = document.getElementById('transcriptPanel');
      if (!panel) return;
      const empty = panel.querySelector('.tx-empty');
      if (empty) empty.remove();
      const entry = document.createElement('div');
      entry.className = 'tx-entry';
      const speaker = (data?.speaker || 'speaker').toString();
      const text = (data?.text || '').toString();
      const ts = data?.timestamp;
      let t = '';
      try { if (typeof ts === 'number') t = new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch {}
      entry.innerHTML = `
        <span class="tx-sp ${speaker}">${speaker}</span>
        <span class="tx-text"></span>
        <span class="tx-time">${t}</span>
      `;
      entry.querySelector('.tx-text').textContent = text;
      panel.appendChild(entry);
      panel.scrollTop = panel.scrollHeight;
    };
    socketClient.on('transcript', _sessionTranscriptHandler);
  }

  socketClient.joinSession(sessionId);
  document.getElementById('sessTranscriptWrap').classList.remove('hidden');
  document.getElementById('txSessionId').textContent = sessionId;
  nav('sessions');
}

function leaveSession() {
  State.sessionContext = null;
  document.getElementById('sessTranscriptWrap').classList.add('hidden');
  document.getElementById('transcriptPanel').innerHTML = '<div class="tx-empty">Waiting for transcript…</div>';
}

// ── PROGRESS ──────────────────────────────────────────────────
async function loadProgress() {
  // TODO: Load real progress data
  const container = document.getElementById('pg-progress');
  container.innerHTML = `
    <div class="pg-hdr">
      <div><div class="pg-title">My Progress</div><div class="pg-desc">Track your learning journey</div></div>
    </div>
    <div class="progress-grid glass">
      <div class="prog-item">
        <div class="prog-lbl">Lectures Studied</div>
        <div class="prog-val">12</div>
        <div class="prog-bar"><div class="prog-fill" style="width:60%"></div></div>
      </div>
      <div class="prog-item">
        <div class="prog-lbl">Quizzes Completed</div>
        <div class="prog-val">8</div>
        <div class="prog-bar"><div class="prog-fill" style="width:40%"></div></div>
      </div>
      <div class="prog-item">
        <div class="prog-lbl">Sessions Attended</div>
        <div class="prog-val">5</div>
        <div class="prog-bar"><div class="prog-fill" style="width:25%"></div></div>
      </div>
    </div>
  `;
}

// ── SYSTEM STATUS ─────────────────────────────────────────────
async function checkSystemStatus() {
  try {
    const status = await api.health();
    dot('llmDot', status.llm ? 'ok' : 'er');
    dot('sockDot', socketClient.connected ? 'ok' : 'er');
  } catch (e) {
    dot('llmDot', 'er');
    dot('sockDot', 'er');
  }
}

function dot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sdot ' + (state === 'ok' ? 'ok' : state === 'er' ? 'er' : 'ld');
}

// ── EVENTS ────────────────────────────────────────────────────
function setupStudentEvents() {
  // Chat input
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  // Mode buttons
  document.getElementById('modeGrid').addEventListener('click', e => {
    if (e.target.classList.contains('mode-btn')) {
      setChatMode(e.target.dataset.mode);
    }
  });

  // Search
  document.getElementById('libSearch').addEventListener('input', filterLectures);

  // Voice button
  document.getElementById('voiceBtn').addEventListener('click', toggleVoice);
}

let voiceActive = false;
function toggleVoice() {
  voiceActive = !voiceActive;
  document.getElementById('voiceBtn').classList.toggle('active', voiceActive);
  if (voiceActive) {
    // TODO: Start voice recognition
    toast('Voice input activated', 'info');
  } else {
    toast('Voice input deactivated', 'info');
  }
}

// ── STUDY PLANNER ───────────────────────────────────────────
async function generatePlan() {
  const topics = document.getElementById('planTopics').value.trim();
  const hours = document.getElementById('planHours').value;
  const duration = document.getElementById('planDuration').value;

  if (!topics) {
    toast('Please enter topics to study', 'error');
    return;
  }

  const btn = document.getElementById('planBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Generating…';
  btn.querySelector('.btn-loader').classList.remove('hidden');

  try {
    // Mock plan generation - in real app, call API
    const plan = `**Study Plan for ${duration}**

**Daily Schedule (${hours} hours/day):**
- 30 min: Review previous material
- 1 hour: Core topic study (${topics.split(',')[0]})
- 30 min: Practice exercises
- 30 min: Quiz/review

**Weekly Focus:**
- Week 1: Fundamentals
- Week 2: Advanced concepts
- Week 3: Practice and assessment

**Tips:** Stay consistent, take breaks, and review regularly.`;

    document.getElementById('planText').innerHTML = plan.replace(/\n/g, '<br>');
    document.getElementById('planOutput').classList.remove('hidden');
    toast('Study plan generated!', 'success');
  } catch (e) {
    toast('Failed to generate plan', 'error');
    console.error('Plan gen error:', e);
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '⚡ Generate Study Plan';
    btn.querySelector('.btn-loader').classList.add('hidden');
  }
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (Auth.isLoggedIn()) {
    initStudent();
  } else {
    window.location.href = './index.html';
  }
});