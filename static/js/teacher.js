// ============================================================
// O.R.I.S. Teacher/Lecturer Dashboard
// ============================================================
'use strict';

/* global API, Auth, CONFIG, socketClient,
          getApiBaseUrl, isMockMode, MockModeUI */

const State = {
  user:          null,
  lectures:      [],
  activeSession: null,
  sessionStart:  null,
  txCount:       0,
  txWords:       0,
  lecInsights:   0,
  stuInsights:   0,
  quizData:      null,
  selectedFiles: [],
  _durationTimer: null,
};

// ── HELPERS ───────────────────────────────────────────────────

const _tc = document.getElementById('toastCont');
function toast(msg, type = 'inf') {
  if (!_tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  _tc.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3800);
}
function escHtml(s) { const d=document.createElement('div'); d.textContent=String(s??''); return d.innerHTML; }
function formatDate(iso) { try { return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); } catch { return iso||'—'; } }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function setEl(id, v) { const el=document.getElementById(id); if(el) el.textContent=v; }
function setBtnLoading(btnId, loading) {
  const btn = typeof btnId==='string' ? document.getElementById(btnId) : btnId;
  if (!btn) return;
  btn.disabled = loading;
  btn.querySelector('.btn-text')?.classList.toggle('hidden', loading);
  const l = btn.querySelector('.btn-loader');
  if (l) l.classList.toggle('hidden', !loading);
}

// ── NAV ───────────────────────────────────────────────────────

function nav(page) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.getElementById('pg-' + page)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', (b.getAttribute('onclick')||'').includes(`'${page}'`));
  });
  const labels = { live:'Live Class', upload:'Upload', lectures:'Your Lectures', quiz:'Create Quiz', analytics:'Stats' };
  setEl('bcPage', labels[page] || page);
  if (page==='lectures')  loadTeacherLectures();
  if (page==='analytics') loadAnalytics();
  if (page==='quiz')      populateQuizLecDropdown();
}

// ── INIT ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // [1] Auth check — lecturer or admin
  if (!Auth.isLoggedIn()) { window.location.href='/'; return; }
  const user = Auth.getUser();
  if (!user || user.role === 'student') { window.location.href='/student.html'; return; }
  State.user = user;

  setEl('sbName', user.username || '—');
  const sbAv = document.getElementById('sbAv');
  if (sbAv) sbAv.textContent = Auth.initials();

  const loadOv   = document.getElementById('loadOv');
  const bootFill = document.getElementById('bootFill');
  const loadMsg  = document.getElementById('loadMsg');

  const steps = [[20,'Authenticating…'],[50,'Checking system…'],[75,'Loading lectures…'],[100,'Ready.']];
  for (const [pct, text] of steps) {
    if (bootFill) bootFill.style.width = pct+'%';
    if (loadMsg)  loadMsg.textContent  = text;
    await sleep(250);
  }

  await Promise.allSettled([checkSystemStatus(), loadTeacherLectures()]);

  connectSocket();
  initMockModeControls();

  if (loadOv) loadOv.style.display = 'none';
});

// ── STATUS ────────────────────────────────────────────────────

async function checkSystemStatus() {
  try {
    // [2] /health returns { llm:bool, stt:bool, db:bool, status:"ok" }
    const h = await API.health();
    if (!h) return;

    const setDot = (id, ok) => {
      const el = document.getElementById(id);
      if (el) el.className = 'sdot ' + (ok ? 'online' : 'loading');
    };
    const setHssDot = (id, ok) => {
      const el = document.getElementById(id);
      if (el) el.className = 'hss-dot ' + (ok ? 'hss-online' : 'hss-loading');
    };

    setDot('llmDot', h.llm);
    setDot('sockDot', socketClient.connected);
    setHssDot('hssLlm', h.llm);
    setHssDot('hssSock', socketClient.connected);
    setEl('tkLlm', h.llm ? 'ONLINE' : 'LOADING');

  } catch (e) {
    console.warn('[teacher] health check:', e.message);
  }
}

// ── SOCKET ────────────────────────────────────────────────────

function connectSocket() {
  const base = getApiBaseUrl();
  if (!base) return;

  try {
    socketClient.connect(base, Auth.getToken());
    socketClient.on('socket_connected',    () => {
      document.getElementById('sockDot')?.classList.replace('loading','online');
      document.getElementById('hssSock')?.classList.replace('hss-loading','hss-online');
    });
    socketClient.on('socket_disconnected', () => {
      document.getElementById('sockDot')?.classList.replace('online','loading');
    });
  } catch (e) {
    console.warn('[teacher] socket failed:', e.message);
  }
}

// ── LIVE SESSION ──────────────────────────────────────────────

let _lecturerWS    = null;
let _speechRec     = null;
let _isRecording   = false;

async function startSession() {
  const title   = document.getElementById('sessTitle')?.value.trim() || 'Live Lecture';
  const topic   = document.getElementById('sessTopic')?.value.trim() || '';
  const audioMode = document.getElementById('sessAudioMode')?.value || 'speech';

  setBtnLoading('startSessionBtn', true);

  try {
    // [8] POST /sessions
    const res = await API.post('/sessions', { title });
    const sid = res.session_id;

    State.activeSession = { id: sid, title, topic, audioMode };
    State.sessionStart  = Date.now();
    State.txCount = State.txWords = State.lecInsights = State.stuInsights = 0;

    // Show active session UI
    document.getElementById('launchPad')?.classList.add('hidden');
    document.getElementById('activeSessionWrap')?.classList.remove('hidden');
    setEl('activeTitle',     title);
    setEl('activeSessionId', sid);
    setEl('tkSess',          'LIVE');
    document.getElementById('navLivePulse')?.classList.remove('hidden');

    // Insight toggle
    const insightEnabled = document.getElementById('insightEnabled')?.checked !== false;
    if (!insightEnabled) {
      // will disable via WS once connected
    }

    // Connect WebSocket to Cell 8 live engine
    connectLecturerWS(sid, topic);

    // Duration timer
    State._durationTimer = setInterval(() => {
      if (!State.sessionStart) return;
      const secs = Math.floor((Date.now() - State.sessionStart) / 1000);
      const m = String(Math.floor(secs/60)).padStart(2,'0');
      const s = String(secs%60).padStart(2,'0');
      setEl('metDuration', `${m}:${s}`);
    }, 1000);

    toast('Session started: ' + title, 'ok');

  } catch (e) {
    toast('Failed to start session: ' + e.message, 'err');
  } finally {
    setBtnLoading('startSessionBtn', false);
  }
}

function connectLecturerWS(sessionId, topic) {
  try {
    if (_lecturerWS) { try { _lecturerWS.close(); } catch {} }

    const base = getApiBaseUrl()
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    // [3] Cell 8 WebSocket: /live/lecturer/{session_id}
    const params = new URLSearchParams({
      lecture_id:    sessionId,
      lecturer_id:   State.user.id || State.user.username,
      lecture_topic: topic || '',
    });
    const url = `${base}/live/lecturer/${sessionId}?${params}`;

    _lecturerWS = new WebSocket(url);

    _lecturerWS.onopen = () => {
      console.log('[ws] lecturer connected:', sessionId);
      document.getElementById('hssRec') &&
        (document.getElementById('hssRec').className = 'hss-dot hss-online');
    };

    _lecturerWS.onmessage = (evt) => {
      try { routeLecturerWS(JSON.parse(evt.data)); } catch {}
    };

    _lecturerWS.onclose = () => {
      console.log('[ws] lecturer WS closed');
      _isRecording = false;
      updateRecBtn(false);
    };

    _lecturerWS.onerror = (e) => console.warn('[ws] lecturer error:', e);

  } catch (e) {
    console.warn('[teacher] lecturer WS failed:', e.message);
    toast('WebSocket connection failed', 'err');
  }
}

function routeLecturerWS(msg) {
  const type    = msg.type    || '';
  const payload = msg.payload || {};

  switch (type) {
    // Transcript from Whisper STT
    case 'transcript:final':
      appendTeacherTranscript(payload.text || '', payload.confidence || 1.0);
      break;
    case 'transcript:interim':
      appendTeacherInterim(payload.text || '');
      break;

    // [5] Lecturer coaching insights (private)
    case 'insight:lecturer:chunk':
      appendLecInsightChunk(payload.insight_id, payload.chunk || '');
      break;
    case 'insight:lecturer:done':
      finaliseLecInsight(payload.insight_id);
      break;

    // Student insight preview on teacher dashboard
    case 'insight:student:chunk':
      appendStuInsightChunk(payload.insight_id, payload.chunk || '');
      break;
    case 'insight:student:done':
      finaliseStuInsight(payload.insight_id);
      break;

    case 'session:state':
      if (payload.students_online !== undefined) {
        setEl('metStudents', payload.students_online);
        setEl('tkStudents',  payload.students_online);
      }
      if (payload.insights !== undefined) {
        setEl('icInsightTotal', payload.insights);
      }
      break;
  }
}

// Transcript DOM
function appendTeacherTranscript(text, confidence) {
  const waiting = document.getElementById('txWaitingTeacher');
  if (waiting) waiting.style.display = 'none';

  const content = document.getElementById('txContentTeacher');
  if (!content) return;

  const el = document.createElement('div');
  el.className   = 'tx-segment';
  el.textContent = text;
  content.appendChild(el);
  content.scrollTop = content.scrollHeight;

  State.txWords += text.split(/\s+/).length;
  setEl('txBadge',        State.txWords + ' WORDS');
  setEl('txConfTeacher',  Math.round((confidence||1)*100)+'%');
  setEl('metWords',       State.txWords);
  setEl('tkWords',        State.txWords);
}

function appendTeacherInterim(text) {
  const el = document.getElementById('txInterimTeacher');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
}

function clearTeacherTranscript() {
  State.txWords = 0;
  const content  = document.getElementById('txContentTeacher');
  const interim  = document.getElementById('txInterimTeacher');
  const waiting  = document.getElementById('txWaitingTeacher');
  if (content) content.innerHTML = '';
  if (interim) { interim.textContent=''; interim.classList.add('hidden'); }
  if (waiting) waiting.style.display = '';
  setEl('txBadge', '0 WORDS');
}

// Lecturer insight DOM
const _lecInsightBuffers = {};
function appendLecInsightChunk(id, chunk) {
  const waiting = document.getElementById('lecInsightWaiting');
  if (waiting) waiting.style.display = 'none';
  const scroll = document.getElementById('lecInsightScroll');
  if (!scroll) return;
  if (!_lecInsightBuffers[id]) {
    const el = document.createElement('div');
    el.className = 'insight-card insight-card--lec streaming';
    el.id = 'linsc-'+id;
    scroll.appendChild(el);
    _lecInsightBuffers[id] = el;
  }
  _lecInsightBuffers[id].textContent += chunk;
  scroll.scrollTop = scroll.scrollHeight;
}
function finaliseLecInsight(id) {
  const el = _lecInsightBuffers[id];
  if (el) el.classList.remove('streaming');
  delete _lecInsightBuffers[id];
  State.lecInsights++;
  setEl('lecInsightCount', State.lecInsights);
  setEl('icInsightTotal',  State.lecInsights + State.stuInsights);
  setEl('metInsights',     State.lecInsights + State.stuInsights);
}

// Student insight preview DOM
const _stuInsightBuffers = {};
function appendStuInsightChunk(id, chunk) {
  const waiting = document.getElementById('stuInsightWaiting');
  if (waiting) waiting.style.display = 'none';
  const scroll = document.getElementById('stuInsightScroll');
  if (!scroll) return;
  if (!_stuInsightBuffers[id]) {
    const el = document.createElement('div');
    el.className = 'insight-card streaming';
    el.id = 'sinsc-'+id;
    scroll.appendChild(el);
    _stuInsightBuffers[id] = el;
  }
  _stuInsightBuffers[id].textContent += chunk;
  scroll.scrollTop = scroll.scrollHeight;
}
function finaliseStuInsight(id) {
  const el = _stuInsightBuffers[id];
  if (el) el.classList.remove('streaming');
  delete _stuInsightBuffers[id];
  State.stuInsights++;
  setEl('stuInsightCount', State.stuInsights);
}

// ── RECORDING ─────────────────────────────────────────────────

function toggleRecording() {
  if (_isRecording) { stopRecording(); } else { startRecording(); }
}

function startRecording() {
  if (!State.activeSession || !_lecturerWS || _lecturerWS.readyState !== WebSocket.OPEN) {
    toast('Start a session first', 'err'); return;
  }

  const audioMode = State.activeSession.audioMode || 'speech';

  if (audioMode === 'speech') {
    // Web Speech API → send text via WS as transcript message
    try {
      _speechRec = socketClient.createSpeechRecognizer(
        (text, isFinal) => {
          if (!_lecturerWS || _lecturerWS.readyState !== WebSocket.OPEN) return;
          // [3] Send transcript text message to Cell 8 WS handler
          _lecturerWS.send(JSON.stringify({
            type:    'transcript',
            payload: { text, is_final: isFinal, confidence: 0.95 },
          }));
        },
        () => { _isRecording = false; updateRecBtn(false); }
      );
      _speechRec.start();
      _isRecording = true;
      updateRecBtn(true);
      toast('Speech recognition started', 'ok');
    } catch (e) { toast('Speech error: ' + e.message, 'err'); }

  } else {
    // Socket audio — binary PCM via socketClient
    socketClient.startRecording(State.activeSession.id)
      .then(() => { _isRecording = true; updateRecBtn(true); })
      .catch(e => toast('Mic error: ' + e.message, 'err'));
  }
}

function stopRecording() {
  if (_speechRec) { try { _speechRec.stop(); } catch {} _speechRec = null; }
  if (socketClient.isRecording) socketClient.stopRecording();
  _isRecording = false;
  updateRecBtn(false);
}

function updateRecBtn(recording) {
  const btn    = document.getElementById('recBtn');
  const lbl    = document.getElementById('recBtnLbl');
  const dot    = document.getElementById('recDotBtn');
  const hssDot = document.getElementById('hssRec');
  const recDot = document.getElementById('recDot');

  if (btn)    btn.classList.toggle('recording', recording);
  if (lbl)    lbl.textContent = recording ? 'STOP MIC' : 'START MIC';
  if (dot)    dot.classList.toggle('active', recording);
  if (hssDot) hssDot.className = 'hss-dot ' + (recording ? 'hss-active' : '');
  if (recDot) recDot.className = 'sdot ' + (recording ? 'online' : '');
}

// ── INSIGHT CONTROLS ──────────────────────────────────────────

// [6] Send insight:trigger via WebSocket → Cell 8 handle_lecturer_ws
function triggerInsightNow() {
  if (!_lecturerWS || _lecturerWS.readyState !== WebSocket.OPEN) {
    toast('No active session', 'err'); return;
  }
  _lecturerWS.send(JSON.stringify({
    type:    'insight:trigger',
    payload: {},
  }));
  toast('Insight generation triggered', 'ok');
}

// [7] Send insight:enable / insight:disable via WebSocket
function toggleInsights(enabled) {
  if (!_lecturerWS || _lecturerWS.readyState !== WebSocket.OPEN) return;
  _lecturerWS.send(JSON.stringify({
    type:    enabled ? 'insight:enable' : 'insight:disable',
    payload: {},
  }));
  setEl('icbState', enabled ? 'ON' : 'PAUSED');
  toast('Insights ' + (enabled ? 'enabled' : 'disabled'), 'inf');
}

// ── END SESSION ───────────────────────────────────────────────

async function endSession() {
  if (!State.activeSession) return;

  stopRecording();
  if (_lecturerWS) { try { _lecturerWS.close(); } catch {} _lecturerWS = null; }
  if (State._durationTimer) { clearInterval(State._durationTimer); State._durationTimer = null; }

  try {
    // [8] DELETE /sessions/{session_id}
    await API.delete('/sessions/' + State.activeSession.id);
  } catch (e) { console.warn('[teacher] end session:', e.message); }

  State.activeSession = null;
  State.sessionStart  = null;

  document.getElementById('launchPad')?.classList.remove('hidden');
  document.getElementById('activeSessionWrap')?.classList.add('hidden');
  document.getElementById('navLivePulse')?.classList.add('hidden');
  setEl('tkSess', 'OFFLINE');
  clearTeacherTranscript();
  toast('Session ended', 'inf');
}

// ── UPLOAD ────────────────────────────────────────────────────

function handleDragOver(e) { e.preventDefault(); document.getElementById('uploadDropZone')?.classList.add('over'); }
function handleDragLeave() { document.getElementById('uploadDropZone')?.classList.remove('over'); }
function handleDrop(e) { e.preventDefault(); handleDragLeave(); const f=e.dataTransfer?.files?.[0]; if(f) queueFile(f); }
function handleFileSelect(e) { const f=e.target?.files?.[0]; if(f) queueFile(f); }

function queueFile(file) {
  const allowed = ['.pdf','.docx','.pptx','.txt','.md'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) { toast(`${ext} not supported`, 'err'); return; }

  State.selectedFiles = [file];

  const queue = document.getElementById('fileQueue');
  const list  = document.getElementById('fileQueueList');
  if (list) list.innerHTML = `
    <div class="fq-item">
      <span style="font-size:.75rem;color:var(--text)">${escHtml(file.name)}</span>
      <span style="font-size:.65rem;color:var(--text3)">${(file.size/1024/1024).toFixed(2)} MB</span>
    </div>`;
  if (queue) queue.classList.remove('hidden');
}

async function uploadLecture() {
  if (!State.selectedFiles.length) { toast('No file selected', 'err'); return; }
  const file  = State.selectedFiles[0];
  const title = document.getElementById('uploadTitle')?.value.trim() || '';

  setBtnLoading('uploadBtn', true);
  document.getElementById('uploadProgress')?.classList.remove('hidden');

  // Animate progress
  const fill = document.getElementById('upFill');
  let pct = 0;
  const anim = setInterval(() => {
    pct = Math.min(pct+2, 88);
    if (fill) fill.style.width = pct+'%';
  }, 150);

  try {
    // [4] POST /lectures/upload
    const form = new FormData();
    form.append('file', file);
    const qs = new URLSearchParams();
    if (title) qs.set('title', title);

    const res = await API.upload('/lectures/upload?' + qs.toString(), form);

    clearInterval(anim);
    if (fill) fill.style.width = '100%';

    toast(`Uploaded: ${res.title || file.name} (${res.rag?.chunks || 0} chunks)`, 'ok');
    clearUpload();
    await loadTeacherLectures();
    populateQuizLecDropdown();

  } catch (e) {
    clearInterval(anim);
    toast('Upload failed: ' + e.message, 'err');
  } finally {
    setBtnLoading('uploadBtn', false);
    setTimeout(() => document.getElementById('uploadProgress')?.classList.add('hidden'), 1500);
  }
}

function clearUpload() {
  State.selectedFiles = [];
  const fi = document.getElementById('fileInput');
  if (fi) fi.value = '';
  document.getElementById('fileQueue')?.classList.add('hidden');
  document.getElementById('uploadTitle') && (document.getElementById('uploadTitle').value='');
  document.getElementById('uploadSubject') && (document.getElementById('uploadSubject').value='');
}

// ── LECTURES ──────────────────────────────────────────────────

async function loadTeacherLectures() {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  try {
    // GET /lectures → array
    const res      = await API.get('/lectures');
    State.lectures = Array.isArray(res) ? res : (res.lectures || []);
    renderTeacherLectures(State.lectures);
  } catch (e) {
    if (grid) grid.innerHTML = `<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>${e.message}</div></div>`;
  }
}

function renderTeacherLectures(lecs) {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  if (!lecs?.length) {
    grid.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO LECTURES YET — UPLOAD ONE</div></div>';
    return;
  }
  grid.innerHTML = lecs.map(l => `
    <div class="lec-card" onclick="makeQuizFromLec('${l.id}')">
      <div style="font-family:var(--fd);font-size:.78rem;color:var(--white);margin-bottom:.25rem">${escHtml(l.title||'Untitled')}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:.75rem">
        <span class="lp-badge">${(l.file_type||'doc').toUpperCase()}</span>
        <span style="font-size:.62rem;color:var(--text3)">${formatDate(l.created_at)}</span>
      </div>
    </div>`).join('');
}

function filterTeacherLectures() {
  const q = document.getElementById('lecSearch')?.value.toLowerCase()||'';
  renderTeacherLectures(State.lectures.filter(l=>(l.title||'').toLowerCase().includes(q)));
}

function makeQuizFromLec(id) {
  const sel = document.getElementById('quizGenLec');
  if (sel) sel.value = id;
  nav('quiz');
}

// ── QUIZ ──────────────────────────────────────────────────────

function populateQuizLecDropdown() {
  ['quizGenLec'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— SELECT —</option>';
    State.lectures.forEach(l => {
      const o = document.createElement('option');
      o.value = l.id; o.textContent = l.title || l.id;
      sel.appendChild(o);
    });
    if (cur) sel.value = cur;
  });
}

async function generateTeacherQuiz() {
  const lecId = document.getElementById('quizGenLec')?.value;
  const num   = parseInt(document.getElementById('quizGenNum')?.value||'5');
  const diff  = document.getElementById('quizGenDiff')?.value||'medium';

  if (!lecId) { toast('Select a lecture', 'err'); return; }

  setBtnLoading('quizGenBtn', true);
  try {
    const res   = await API.post('/quiz/generate', { lecture_id:lecId, num_questions:num, difficulty:diff });
    State.quizData = res;
    renderTeacherQuiz(res.questions || []);
    document.getElementById('quizGenPreview')?.classList.remove('hidden');
    toast(`${(res.questions||[]).length} questions generated`, 'ok');
  } catch (e) {
    toast('Quiz failed: ' + e.message, 'err');
  } finally {
    setBtnLoading('quizGenBtn', false);
  }
}

function renderTeacherQuiz(questions) {
  const wrap = document.getElementById('quizGenContent');
  if (!wrap) return;
  wrap.innerHTML = questions.map((q, i) => `
    <div class="quiz-card">
      <div class="quiz-card-num">Q${i+1}</div>
      <div class="quiz-card-q">${escHtml(q.question)}</div>
      <div class="quiz-opts">
        ${(q.options||[]).map(o => `
          <div class="quiz-opt ${o===q.correct?'correct':''}" style="cursor:default">
            ${escHtml(o)} ${o===q.correct?' ✓':''}
          </div>`).join('')}
      </div>
      ${q.explanation ? `<div style="font-size:.7rem;color:var(--text3);margin-top:.5rem;padding:.5rem;background:rgba(0,255,255,.05);border-radius:4px">${escHtml(q.explanation)}</div>` : ''}
    </div>`).join('');
}

function copyQuizJson() {
  if (!State.quizData) return;
  navigator.clipboard?.writeText(JSON.stringify(State.quizData, null, 2))
    .then(()=>toast('Quiz JSON copied','ok'))
    .catch(()=>toast('Copy failed','err'));
}

function distributeQuiz() { toast('Quiz distributed to students (feature coming soon)', 'inf'); }

// ── ANALYTICS ─────────────────────────────────────────────────

async function loadAnalytics() {
  try {
    const [h, sessions] = await Promise.allSettled([API.health(), API.get('/sessions')]);

    const health   = h.status==='fulfilled' ? h.value : null;
    const sessData = sessions.status==='fulfilled'
      ? (Array.isArray(sessions.value) ? sessions.value : sessions.value?.sessions || [])
      : [];

    setEl('anTotalSessions', sessData.length);
    setEl('anTotalLectures', State.lectures.length);
    setEl('anTotalStudents', '—');
    setEl('anInsightsTotal', '—');

    const grid = document.getElementById('sysHealthGrid');
    if (grid && health) {
      grid.innerHTML = `
        <div style="display:grid;gap:.75rem;padding:1rem">
          ${[
            ['LLM (Qwen 2.5)', health.llm],
            ['STT (Whisper)',  health.stt],
            ['Database',       health.db],
          ].map(([label, ok]) => `
            <div style="display:flex;align-items:center;gap:.75rem">
              <div style="width:8px;height:8px;border-radius:50%;background:${ok?'var(--green)':'var(--amber)'}"></div>
              <span style="font-size:.75rem;flex:1">${label}</span>
              <span style="font-size:.65rem;color:${ok?'var(--green)':'var(--amber)'}">${ok?'ONLINE':'LOADING'}</span>
            </div>`).join('')}
          <div style="font-size:.62rem;color:var(--text3);margin-top:.25rem">
            Formats: ${(health.formats||[]).join(' · ')} · Checked: ${new Date().toLocaleTimeString()}
          </div>
        </div>`;
    }

    // Session history
    const histEl = document.getElementById('sessHistory');
    if (histEl) {
      if (!sessData.length) {
        histEl.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO SESSION HISTORY</div></div>';
      } else {
        histEl.innerHTML = sessData.map(s => `
          <div style="padding:.75rem 1rem;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:1rem">
            <div style="flex:1;font-size:.78rem">${escHtml(s.title||'Session')}</div>
            <div style="font-size:.65rem;color:var(--text3)">${s.status||'—'}</div>
          </div>`).join('');
      }
    }

  } catch (e) { toast('Analytics failed: '+e.message, 'err'); }
}

// ── MOCK MODE ─────────────────────────────────────────────────

function initMockModeControls() {
  const toggle = document.getElementById('mockModeToggle');
  toggle?.addEventListener('change', () => {
    setMockMode(toggle.checked, 'manual');
    toast(toggle.checked ? 'Mock mode ON' : 'Mock mode OFF', 'inf');
  });
}

// ── SIDEBAR ───────────────────────────────────────────────────

function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('open');
  document.getElementById('sbOverlay')?.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sbOverlay')?.classList.remove('open');
}

// ── GLOBALS ───────────────────────────────────────────────────

window.nav                        = nav;
window.startSession               = startSession;
window.endSession                 = endSession;
window.toggleRecording            = toggleRecording;
window.triggerInsightNow          = triggerInsightNow;
window.toggleInsights             = toggleInsights;
window.handleDragOver             = handleDragOver;
window.handleDragLeave            = handleDragLeave;
window.handleDrop                 = handleDrop;
window.handleFileSelect           = handleFileSelect;
window.uploadLecture              = uploadLecture;
window.clearUpload                = clearUpload;
window.loadTeacherLectures        = loadTeacherLectures;
window.filterTeacherLectures      = filterTeacherLectures;
window.makeQuizFromLec            = makeQuizFromLec;
window.generateTeacherQuiz        = generateTeacherQuiz;
window.copyQuizJson               = copyQuizJson;
window.distributeQuiz             = distributeQuiz;
window.loadAnalytics              = loadAnalytics;
window.checkSystemStatus          = checkSystemStatus;
window.toggleSidebar              = toggleSidebar;
window.closeSidebar               = closeSidebar;
window.clearTeacherTranscript     = clearTeacherTranscript;

// ── Cell 6 v2: Teacher AI Tools ───────────────────────────────

async function generateTeacherConceptMap() {
  const lecId = document.getElementById('quizGenLec')?.value;
  if (!lecId) { toast('Select a lecture first', 'err'); return; }
  const btn = document.getElementById('conceptMapBtn');
  setBtnLoading(btn, true);
  try {
    const res  = await API.generateConceptMap(lecId);
    const text = res?.answer || res?.response || (typeof res === 'string' ? res : '');
    const out  = document.getElementById('conceptMapOutput');
    if (out) {
      out.innerHTML = `<div style="font-size:.78rem;color:var(--text2);line-height:1.7;white-space:pre-wrap">${escHtml(text)}</div>`;
      out.classList.remove('hidden');
    }
  } catch (e) { toast('Concept map failed: ' + e.message, 'err'); }
  finally { setBtnLoading(btn, false); }
}

async function generateTeacherFlashcards() {
  const lecId = document.getElementById('quizGenLec')?.value;
  const num   = parseInt(document.getElementById('flashcardNum')?.value || '10');
  if (!lecId) { toast('Select a lecture first', 'err'); return; }
  const btn = document.getElementById('flashcardBtn');
  setBtnLoading(btn, true);
  try {
    const cards = await API.generateFlashcards(lecId, num);
    renderTeacherFlashcards(cards || []);
  } catch (e) { toast('Flashcard generation failed: ' + e.message, 'err'); }
  finally { setBtnLoading(btn, false); }
}

function renderTeacherFlashcards(cards) {
  const wrap = document.getElementById('flashcardPreview');
  if (!wrap) return;
  if (!cards.length) { wrap.innerHTML = '<div class="fui-empty"><div class="fui-empty-icon">◈</div><div>NO CARDS GENERATED</div></div>'; return; }
  wrap.innerHTML = cards.map(c => `
    <div class="fui-panel" style="padding:.75rem;margin-bottom:.5rem">
      <div style="font-size:.7rem;font-weight:600;color:var(--cyan);margin-bottom:.25rem">${escHtml(c.front||'')}</div>
      <div style="font-size:.68rem;color:var(--text2)">${escHtml(c.back||'')}</div>
      ${c.topic ? `<div style="font-size:.58rem;color:var(--text3);margin-top:.25rem">${escHtml(c.topic)}</div>` : ''}
      <span class="lp-badge" style="font-size:.55rem;margin-top:.35rem">${c.difficulty||'medium'}</span>
    </div>`).join('');
  wrap.classList.remove('hidden');
  toast(`${cards.length} flashcards generated`, 'ok');
}

async function generateTeacherMixedQuiz() {
  const lecId = document.getElementById('quizGenLec')?.value;
  const num   = parseInt(document.getElementById('quizGenNum')?.value || '10');
  if (!lecId) { toast('Select a lecture first', 'err'); return; }
  const btn = document.getElementById('mixedQuizBtn');
  setBtnLoading(btn, true);
  try {
    const res = await API.generateMixedQuiz(lecId, num, ['mcq', 'true_false', 'fill_blank']);
    State.quizData = { questions: Array.isArray(res) ? res : [] };
    renderTeacherQuiz(State.quizData.questions);
    document.getElementById('quizGenPreview')?.classList.remove('hidden');
    toast(`${State.quizData.questions.length} mixed questions generated`, 'ok');
  } catch (e) { toast('Mixed quiz failed: ' + e.message, 'err'); }
  finally { setBtnLoading(btn, false); }
}

// Add to window globals at bottom of teacher.js:
window.generateTeacherConceptMap  = generateTeacherConceptMap;
window.generateTeacherFlashcards  = generateTeacherFlashcards;
window.generateTeacherMixedQuiz   = generateTeacherMixedQuiz;