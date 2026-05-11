// ============================================================
// O.R.I.S. TEACHER DASHBOARD — js/teacher.js
// ============================================================

/* ── State ───────────────────────────────────────────────── */
const State = {
  user:          null,
  lectures:      [],
  activeSession: null,   // { id, title }
  txCount:       0,
  quizData:      null,
  selectedFile:  null,
};

/* ── Toast shortcut ──────────────────────────────────────── */
const _tc = document.getElementById('toastCont');
function toast(msg, type = 'inf') {
  const t = document.createElement('div');
  t.className = `toast ${type==='success'?'ok':type==='error'?'err':'inf'}`;
  t.textContent = msg;
  _tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(120%)'; t.style.transition = '.3s';
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function formatDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', {month:'short',day:'numeric',year:'numeric'}); }
  catch { return iso; }
}
function formatTime(ts) {
  try { return new Date(ts*1000).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}); }
  catch { return '—'; }
}

/* ── Navigation ──────────────────────────────────────────── */
const PAGE_LABELS = {
  upload:'Upload Materials', lectures:'My Lectures',
  sessions:'Live Sessions', quiz:'Quiz Creator', analytics:'Analytics',
};
function nav(page) {
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const pg = document.getElementById(`pg-${page}`);
  if (pg) pg.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b => {
    if (b.getAttribute('onclick') === `nav('${page}')`) b.classList.add('active');
  });
  document.getElementById('bcPage').textContent = PAGE_LABELS[page] || page;
  if (page === 'lectures')  loadTeacherLectures();
  if (page === 'sessions')  loadOtherSessions();
  if (page === 'analytics') loadAnalytics();
  if (page === 'quiz')      populateQuizLecDropdown();
}

/* ── Init ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  if (!Auth.isLoggedIn()) { window.location.href = '/'; return; }
  const user = Auth.getUser();
  if (!user || user.role === 'student') { window.location.href = '/student.html'; return; }
  State.user = user;

  document.getElementById('sbName').textContent = user.username;
  document.getElementById('sbAv').textContent   = Auth.initials();

  setLoadMsg('Connecting to backend…');
  await checkSystemStatus();

  setLoadMsg('Setting up socket…');
  connectSocket();

  setLoadMsg('Loading lectures…');
  await loadTeacherLectures();

  setLoadMsg('Ready!');
  setTimeout(() => document.getElementById('loadOv').classList.add('hidden'), 600);

  // Drag/drop on upload zone
  const zone = document.getElementById('uploadZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFileSelect(f);
  });
});

function setLoadMsg(m) {
  const el = document.getElementById('loadMsg');
  if (el) el.textContent = m;
}

/* ── System status ───────────────────────────────────────── */
async function checkSystemStatus() {
  try {
    const h = await api.health();
    setDot('llmDot', h.llm ? 'ok' : 'ld');
    document.getElementById('llmLbl').textContent = h.llm ? 'LLM ✓' : 'LLM…';
    return h;
  } catch(e) {
    setDot('llmDot', 'er');
    return null;
  }
}
function setDot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sdot ' + (state==='ok'?'ok':state==='ld'?'ld':'er');
}

/* ── Socket ──────────────────────────────────────────────── */
function connectSocket() {
  if (!CONFIG.BACKEND_URL) return;
  socketClient.connect(CONFIG.BACKEND_URL, api.getToken());
  socketClient.on('connect',    () => setDot('sockDot','ok'));
  socketClient.on('disconnect', () => setDot('sockDot','er'));
  socketClient.on('error',      () => setDot('sockDot','er'));
  socketClient.on('transcript', appendLiveTranscript);
  socketClient.on('recording_start', () => {
    document.getElementById('recInd').style.display = 'flex';
    document.getElementById('micBtn').textContent = '🔴 Stop Mic';
  });
  socketClient.on('recording_stop', () => {
    document.getElementById('recInd').style.display = 'none';
    document.getElementById('micBtn').textContent = '🎙 Start Mic';
  });
}

/* ── UPLOAD ──────────────────────────────────────────────── */
function handleFileSelect(file) {
  if (!file) return;
  const allowed = ['.pdf','.docx','.pptx','.txt','.md'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    toast(`File type "${ext}" not supported`, 'error');
    return;
  }
  State.selectedFile = file;
  const prev = document.getElementById('filePreview');
  document.getElementById('fpName').textContent = file.name;
  document.getElementById('fpSize').textContent = formatBytes(file.size);
  prev.classList.remove('hidden');
  prev.style.display = 'flex';
  document.getElementById('uploadBtn').disabled = false;
  document.getElementById('uploadResult').classList.add('hidden');
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n/1024).toFixed(1) + ' KB';
  return (n/1048576).toFixed(1) + ' MB';
}

async function doUpload() {
  if (!State.selectedFile) { toast('Select a file first', 'error'); return; }
  if (!CONFIG.BACKEND_URL) { toast('Backend URL not set', 'error'); return; }

  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loader').classList.remove('hidden');

  const progWrap = document.getElementById('upProgWrap');
  const prog     = document.getElementById('upProg');
  progWrap.classList.remove('hidden');
  prog.style.width = '0';
  // Animate progress bar (indeterminate feel)
  let pct = 0;
  const anim = setInterval(() => { pct = Math.min(pct + 2, 88); prog.style.width = pct + '%'; }, 100);

  const fd = new FormData();
  fd.append('file', State.selectedFile);
  const title  = document.getElementById('upTitle').value.trim();
  const course = document.getElementById('upCourse').value.trim();
  let url = `${CONFIG.BACKEND_URL}/lectures/upload`;
  const params = new URLSearchParams();
  if (title)  params.append('title', title);
  if (course) params.append('course_id', course);
  if (params.toString()) url += '?' + params.toString();

  const resultEl = document.getElementById('uploadResult');
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${api.getToken()}` },
      body: fd,
    });
    clearInterval(anim); prog.style.width = '100%';
    if (!resp.ok) {
      const j = await resp.json().catch(() => ({}));
      throw new Error(j.detail || `HTTP ${resp.status}`);
    }
    const j = await resp.json();
    resultEl.className = 'upload-result ok';
    resultEl.textContent = `✓ Uploaded & indexed: ${j.title} — ${j.rag?.chunks||0} chunks stored`;
    resultEl.classList.remove('hidden');
    toast('Upload successful!', 'success');
    clearUpload();
    await loadTeacherLectures();
    populateQuizLecDropdown();
  } catch(e) {
    clearInterval(anim);
    resultEl.className = 'upload-result err';
    resultEl.textContent = '⚠ ' + (e.message || 'Upload failed');
    resultEl.classList.remove('hidden');
    toast(e.message || 'Upload failed', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loader').classList.add('hidden');
    setTimeout(() => { progWrap.classList.add('hidden'); prog.style.width='0'; }, 1200);
  }
}

function clearUpload() {
  State.selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').style.display = 'none';
  document.getElementById('uploadBtn').disabled = true;
  document.getElementById('upTitle').value  = '';
  document.getElementById('upCourse').value = '';
}

/* ── MY LECTURES ─────────────────────────────────────────── */
async function loadTeacherLectures() {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty"><span class="empty-ico">⟳</span>Loading…</div>';
  try {
    State.lectures = await api.getLectures();
    renderTeacherLectures(State.lectures);
  } catch(e) {
    grid.innerHTML = `<div class="empty"><span class="empty-ico">⚠</span>${e.message}</div>`;
  }
}

function renderTeacherLectures(lecs) {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  if (!lecs.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-ico">📤</span>No lectures uploaded yet.</div>';
    return;
  }
  grid.innerHTML = lecs.map(l => {
    const badgeCls = {pdf:'b-pdf',docx:'b-docx',pptx:'b-pptx'}[l.file_type]||'b-text';
    return `<div class="glass lec-card">
      <span class="lec-badge ${badgeCls}">${(l.file_type||'doc').toUpperCase()}</span>
      <div class="lec-title">${escHtml(l.title)}</div>
      <div class="lec-meta">${formatDate(l.created_at)}</div>
      <div class="lec-actions">
        <button class="btn-ghost" style="font-size:.65rem" onclick="makeQuizFromLec('${l.id}')">✍ Quiz</button>
      </div>
    </div>`;
  }).join('');
}

function filterTeacherLectures() {
  const q = document.getElementById('lecSearch').value.toLowerCase();
  renderTeacherLectures(State.lectures.filter(l => l.title.toLowerCase().includes(q)));
}

function makeQuizFromLec(id) {
  document.getElementById('qzLecSel').value = id;
  nav('quiz');
}

/* ── LIVE SESSIONS (Teacher) ─────────────────────────────── */
function openCreateSession() {
  document.getElementById('createSessPanel').classList.remove('hidden');
  document.getElementById('sessTitle').focus();
}
function closeCreateSession() {
  document.getElementById('createSessPanel').classList.add('hidden');
}

async function createSession() {
  const title  = document.getElementById('sessTitle').value.trim() || 'Live Lecture';
  const course = document.getElementById('sessCourse').value.trim() || null;
  const btn    = document.getElementById('createSessBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loader').classList.remove('hidden');
  try {
    const res = await api.createSession(title, course);
    State.activeSession = { id: res.session_id, title };
    State.txCount = 0;

    // Join via socket
    if (socketClient.connected) socketClient.joinSession(res.session_id);

    // Show active session UI
    document.getElementById('activeSessControl').classList.remove('hidden');
    document.getElementById('activeSessTitle').textContent = title;
    document.getElementById('activeSessId').textContent = `ID: ${res.session_id}`;
    document.getElementById('teacherTranscript').innerHTML = '<div class="tx-empty">Waiting for speech…</div>';
    closeCreateSession();

    // Update badge
    const badge = document.getElementById('activeSessBadge');
    badge.style.display = 'inline-block';
    badge.textContent = '1';

    toast(`Session "${title}" started!`, 'success');
  } catch(e) {
    toast(e.message || 'Failed to create session', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loader').classList.add('hidden');
  }
}

async function endSession() {
  if (!State.activeSession) return;
  if (!confirm('End this live session?')) return;
  try {
    await api.endSession(State.activeSession.id);
    if (socketClient.isRecording) socketClient.stopRecording();
    State.activeSession = null;
    State.txCount = 0;
    document.getElementById('activeSessControl').classList.add('hidden');
    document.getElementById('activeSessBadge').style.display = 'none';
    toast('Session ended', 'inf');
    loadOtherSessions();
  } catch(e) {
    toast(e.message || 'Failed to end session', 'error');
  }
}

function toggleMic() {
  if (!State.activeSession) { toast('No active session', 'error'); return; }
  if (socketClient.isRecording) {
    socketClient.stopRecording();
  } else {
    socketClient.startRecording(State.activeSession.id);
  }
}

function appendLiveTranscript(data) {
  const panel = document.getElementById('teacherTranscript');
  if (!panel) return;
  const empty = panel.querySelector('.tx-empty');
  if (empty) empty.remove();
  State.txCount++;
  const entry = document.createElement('div');
  entry.className = 'tx-entry';
  entry.innerHTML = `
    <span class="tx-sp ${data.speaker}">${data.speaker}</span>
    <span class="tx-text">${escHtml(data.text)}</span>
    <span class="tx-time">${formatTime(data.timestamp)}</span>
  `;
  panel.appendChild(entry);
  panel.scrollTop = panel.scrollHeight;
  const cnt = document.getElementById('txCount');
  if (cnt) cnt.textContent = `${State.txCount} entr${State.txCount===1?'y':'ies'}`;
}

async function loadOtherSessions() {
  const list = document.getElementById('otherSessList');
  if (!list) return;
  try {
    const sessions = await api.getSessions();
    const others = sessions.filter(s => s.id !== State.activeSession?.id);
    if (!others.length) {
      list.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">No other active sessions.</span>';
      return;
    }
    list.innerHTML = others.map(s => `
      <div class="glass sess-card">
        <div class="live-dot"></div>
        <div class="sess-info">
          <div class="sess-title">${escHtml(s.title)}</div>
          <div class="sess-id">${s.id.substring(0,12)}…</div>
        </div>
      </div>
    `).join('');
  } catch(e) {
    list.innerHTML = `<span style="font-family:var(--fm);font-size:.72rem;color:var(--magenta)">${e.message}</span>`;
  }
}

/* ── QUIZ CREATOR ────────────────────────────────────────── */
function populateQuizLecDropdown() {
  const sel = document.getElementById('qzLecSel');
  if (!sel) return;
  sel.innerHTML = '<option value="">— choose —</option>';
  State.lectures.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id; o.textContent = l.title;
    sel.appendChild(o);
  });
}

async function teacherGenerateQuiz() {
  const lecId = document.getElementById('qzLecSel').value;
  const num   = parseInt(document.getElementById('qzNumSel').value);
  const diff  = document.getElementById('qzDiffSel').value;
  if (!lecId) { toast('Select a lecture first', 'error'); return; }

  const btn = document.getElementById('qzGenBtn');
  btn.disabled = true;
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loader').classList.remove('hidden');

  try {
    const res = await api.generateQuiz(lecId, num, diff);
    State.quizData = res;
    renderTeacherQuiz(res.questions);
    document.getElementById('qzPreviewWrap').classList.remove('hidden');
    toast(`${res.questions.length} questions generated!`, 'success');
  } catch(e) {
    toast(e.message || 'Quiz generation failed', 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loader').classList.add('hidden');
  }
}

function renderTeacherQuiz(questions) {
  const wrap = document.getElementById('qzContent');
  const letters = ['A','B','C','D'];
  wrap.innerHTML = questions.map((q, qi) => {
    const opts = q.options.map((o, oi) => `
      <div class="opt ${oi === q.correct ? 'corr' : ''}" style="cursor:default">
        <span class="opt-letter">${letters[oi]}</span>
        ${escHtml(o)}
        ${oi === q.correct ? ' ✓' : ''}
      </div>
    `).join('');
    return `<div class="glass quiz-q">
      <div class="q-num">Q${qi+1}</div>
      <div class="q-text">${escHtml(q.question)}</div>
      <div class="opts">${opts}</div>
      <div class="quiz-exp show">${escHtml(q.explanation||'')}</div>
    </div>`;
  }).join('');
}

function exportQuizJSON() {
  if (!State.quizData) return;
  const json = JSON.stringify(State.quizData, null, 2);
  const blob = new Blob([json], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'oris_quiz.json';
  a.click(); URL.revokeObjectURL(url);
  toast('Quiz exported as JSON', 'success');
}

function resetTeacherQuiz() {
  State.quizData = null;
  document.getElementById('qzContent').innerHTML = '';
  document.getElementById('qzPreviewWrap').classList.add('hidden');
}

/* ── ANALYTICS ───────────────────────────────────────────── */
async function loadAnalytics() {
  try {
    const h = await api.health();

    document.getElementById('aLectures').textContent  = State.lectures.length || '—';
    document.getElementById('aSessions').textContent  = (await api.getSessions()).length;
    document.getElementById('aLLM').textContent       = h.llm ? 'ONLINE' : 'LOADING';
    document.getElementById('aDB').textContent        = h.db  ? 'ONLINE' : 'ERROR';

    document.getElementById('aLLM').className = `stat-val ${h.llm ? 'grn' : 'mag'}`;
    document.getElementById('aDB').className  = `stat-val ${h.db  ? 'grn' : 'mag'}`;

    const det = document.getElementById('healthDetails');
    det.innerHTML = `
      <div class="prog-bar-row">
        <span class="prog-bar-label">LLM (Qwen)</span>
        <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.llm?100:20}%"></div></div>
        <span class="prog-bar-val" style="color:${h.llm?'var(--green)':'var(--magenta)'}">${h.llm?'OK':'WAIT'}</span>
      </div>
      <div class="prog-bar-row">
        <span class="prog-bar-label">STT (Whisper)</span>
        <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.stt?100:0}%"></div></div>
        <span class="prog-bar-val" style="color:${h.stt?'var(--green)':'var(--magenta)'}">${h.stt?'OK':'N/A'}</span>
      </div>
      <div class="prog-bar-row">
        <span class="prog-bar-label">Database</span>
        <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.db?100:0}%"></div></div>
        <span class="prog-bar-val" style="color:${h.db?'var(--green)':'var(--magenta)'}">${h.db?'OK':'ERR'}</span>
      </div>
      <div style="font-family:var(--fm);font-size:.65rem;color:var(--text3);margin-top:.25rem">
        Formats: ${(h.formats||[]).join(' · ')} · Last checked: ${new Date().toLocaleTimeString()}
      </div>
    `;

    // Lecture list
    const lecEl = document.getElementById('analyticsLecList');
    if (State.lectures.length) {
      lecEl.innerHTML = State.lectures.slice(0,8).map(l => `
        <div style="display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid var(--border)">
          <span class="lec-badge ${({pdf:'b-pdf',docx:'b-docx',pptx:'b-pptx'}[l.file_type]||'b-text')}" style="margin:0">${(l.file_type||'doc').toUpperCase()}</span>
          <span style="flex:1;font-size:.82rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l.title)}</span>
          <span style="font-family:var(--fm);font-size:.62rem;color:var(--text3)">${formatDate(l.created_at)}</span>
        </div>
      `).join('');
    } else {
      lecEl.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">No lectures yet.</span>';
    }
  } catch(e) {
    toast('Analytics fetch failed: ' + e.message, 'error');
  }
}