// ============================================================
// O.R.I.S. TEACHER DASHBOARD — js/teacher.js (v2.0)
// Fixed: upload URL, nav(), socket init, mock mode, mobile sidebar
// ============================================================

/* global api, Auth, CONFIG, socketClient, getApiBaseUrl, isMockMode */

/* ── State ───────────────────────────────────────────────── */
const State = {
  user:          null,
  lectures:      [],
  activeSession: null,
  txCount:       0,
  quizData:      null,
  selectedFile:  null,
};

/* ── Toast shortcut ──────────────────────────────────────── */
const _tc = document.getElementById('toastCont');
function toast(msg, type = 'inf') {
  if (!_tc) return;
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'success' ? 'ok' : type === 'error' ? 'err' : 'inf');
  t.textContent = msg;
  _tc.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
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
function formatTime(ts) {
  try { return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
}

/* ── Navigation ──────────────────────────────────────────── */
const PAGE_LABELS = {
  upload: 'Upload Materials',
  lectures: 'My Lectures',
  sessions: 'Live Sessions',
  quiz: 'Quiz Creator',
  analytics: 'Analytics',
};

function nav(page) {
  // Hide all pages
  document.querySelectorAll('.pg').forEach(p => p.classList.remove('active'));
  // Show target page
  const pg = document.getElementById('pg-' + page);
  if (pg) pg.classList.add('active');

  // Update nav active state
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.remove('active');
    const onclick = b.getAttribute('onclick') || '';
    if (onclick.includes("nav('" + page + "')")) {
      b.classList.add('active');
    }
  });

  // Update breadcrumb
  const bc = document.getElementById('bcPage');
  if (bc) bc.textContent = PAGE_LABELS[page] || page;

  // Page-specific init
  if (page === 'lectures') loadTeacherLectures();
  if (page === 'sessions') loadOtherSessions();
  if (page === 'analytics') loadAnalytics();
  if (page === 'quiz') populateQuizLecDropdown();
}

/* ── Init ────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Auth check
  if (!Auth.isLoggedIn()) {
    window.location.href = './index.html';
    return;
  }
  const user = Auth.getUser();
  if (!user || user.role === 'student') {
    window.location.href = './student.html';
    return;
  }
  State.user = user;

  // Sidebar user info
  const sbName = document.getElementById('sbName');
  const sbAv = document.getElementById('sbAv');
  if (sbName) sbName.textContent = user.username;
  if (sbAv) sbAv.textContent = Auth.initials();

  setLoadMsg('Connecting to backend…');
  await checkSystemStatus();

  setLoadMsg('Setting up socket…');
  connectSocket();

  setLoadMsg('Loading lectures…');
  await loadTeacherLectures();

  setLoadMsg('Ready!');
  setTimeout(() => {
    const loadOv = document.getElementById('loadOv');
    if (loadOv) loadOv.classList.add('hidden');
  }, 600);

  // Drag/drop on upload zone
  const zone = document.getElementById('uploadZone');
  if (zone) {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('over');
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFileSelect(f);
    });
  }
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
    const llmLbl = document.getElementById('llmLbl');
    if (llmLbl) llmLbl.textContent = h.llm ? 'LLM ✓' : 'LLM…';
    return h;
  } catch (e) {
    setDot('llmDot', 'er');
    return null;
  }
}

function setDot(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'sdot ' + (state === 'ok' ? 'ok' : state === 'ld' ? 'ld' : 'er');
}

/* ── Socket ──────────────────────────────────────────────── */
function connectSocket() {
  let base = '';
  try { base = getApiBaseUrl(); } catch { return; }
  if (!base) return;

  socketClient.connect(base, api.getToken());
  socketClient.on('connect', () => setDot('sockDot', 'ok'));
  socketClient.on('disconnect', () => setDot('sockDot', 'er'));
  socketClient.on('error', () => setDot('sockDot', 'er'));
  socketClient.on('transcript', appendLiveTranscript);
  socketClient.on('recording_start', () => {
    const recInd = document.getElementById('recInd');
    const micBtn = document.getElementById('micBtn');
    if (recInd) recInd.style.display = 'flex';
    if (micBtn) micBtn.textContent = '🔴 Stop Mic';
  });
  socketClient.on('recording_stop', () => {
    const recInd = document.getElementById('recInd');
    const micBtn = document.getElementById('micBtn');
    if (recInd) recInd.style.display = 'none';
    if (micBtn) micBtn.textContent = '🎙 Start Mic';
  });
}

/* ── UPLOAD ──────────────────────────────────────────────── */
function handleFileSelect(file) {
  if (!file) return;
  const allowed = ['.pdf', '.docx', '.pptx', '.txt', '.md'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    toast(`File type "${ext}" not supported`, 'error');
    return;
  }
  State.selectedFile = file;
  const prev = document.getElementById('filePreview');
  const fpName = document.getElementById('fpName');
  const fpSize = document.getElementById('fpSize');
  const uploadBtn = document.getElementById('uploadBtn');
  const uploadResult = document.getElementById('uploadResult');

  if (fpName) fpName.textContent = file.name;
  if (fpSize) fpSize.textContent = formatBytes(file.size);
  if (prev) {
    prev.classList.remove('hidden');
    prev.style.display = 'flex';
  }
  if (uploadBtn) uploadBtn.disabled = false;
  if (uploadResult) uploadResult.classList.add('hidden');
}

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

async function doUpload() {
  if (!State.selectedFile) { toast('Select a file first', 'error'); return; }

  const btn = document.getElementById('uploadBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoader = btn?.querySelector('.btn-loader');
  const progWrap = document.getElementById('upProgWrap');
  const prog = document.getElementById('upProg');
  const resultEl = document.getElementById('uploadResult');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');
  if (progWrap) progWrap.classList.remove('hidden');
  if (prog) prog.style.width = '0';

  // Animate progress bar
  let pct = 0;
  const anim = setInterval(() => {
    pct = Math.min(pct + 2, 88);
    if (prog) prog.style.width = pct + '%';
  }, 100);

  const title = document.getElementById('upTitle')?.value.trim() || '';
  const course = document.getElementById('upCourse')?.value.trim() || '';

  try {
    const j = await api.uploadLecture(State.selectedFile, title || undefined, course || undefined);
    clearInterval(anim);
    if (prog) prog.style.width = '100%';

    if (resultEl) {
      resultEl.className = 'upload-result ok';
      resultEl.textContent = `✓ Uploaded & indexed: ${j.title || j.filename || 'File'} — ${j.rag?.chunks || 0} chunks stored`;
      resultEl.classList.remove('hidden');
    }
    toast('Upload successful!', 'success');
    clearUpload();
    await loadTeacherLectures();
    populateQuizLecDropdown();
  } catch (e) {
    clearInterval(anim);
    if (resultEl) {
      resultEl.className = 'upload-result err';
      resultEl.textContent = '⚠ ' + (e.message || 'Upload failed');
      resultEl.classList.remove('hidden');
    }
    toast(e.message || 'Upload failed', 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
    setTimeout(() => {
      if (progWrap) progWrap.classList.add('hidden');
      if (prog) prog.style.width = '0';
    }, 1200);
  }
}

function clearUpload() {
  State.selectedFile = null;
  const fileInput = document.getElementById('fileInput');
  const filePreview = document.getElementById('filePreview');
  const uploadBtn = document.getElementById('uploadBtn');
  const upTitle = document.getElementById('upTitle');
  const upCourse = document.getElementById('upCourse');

  if (fileInput) fileInput.value = '';
  if (filePreview) filePreview.style.display = 'none';
  if (uploadBtn) uploadBtn.disabled = true;
  if (upTitle) upTitle.value = '';
  if (upCourse) upCourse.value = '';
}

/* ── MY LECTURES ─────────────────────────────────────────── */
async function loadTeacherLectures() {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty"><span class="empty-ico">⟳</span>Loading…</div>';
  try {
    State.lectures = await api.getLectures();
    renderTeacherLectures(State.lectures);
  } catch (e) {
    grid.innerHTML = `<div class="empty"><span class="empty-ico">⚠</span>${e.message || 'Failed to load'}</div>`;
  }
}

function renderTeacherLectures(lecs) {
  const grid = document.getElementById('teacherLecGrid');
  if (!grid) return;
  if (!lecs || !lecs.length) {
    grid.innerHTML = '<div class="empty"><span class="empty-ico">📤</span>No lectures uploaded yet.</div>';
    return;
  }
  grid.innerHTML = lecs.map(l => {
    const badgeCls = { pdf: 'b-pdf', docx: 'b-docx', pptx: 'b-pptx', txt: 'b-text', md: 'b-text' }[l.file_type] || 'b-text';
    return `<div class="glass lec-card">
      <span class="lec-badge ${badgeCls}">${(l.file_type || 'doc').toUpperCase()}</span>
      <div class="lec-title">${escHtml(l.title)}</div>
      <div class="lec-meta">${formatDate(l.created_at)}</div>
      <div class="lec-actions">
        <button class="btn-ghost" style="font-size:.65rem" onclick="makeQuizFromLec('${l.id}')">✍ Quiz</button>
      </div>
    </div>`;
  }).join('');
}

function filterTeacherLectures() {
  const q = (document.getElementById('lecSearch')?.value || '').toLowerCase();
  renderTeacherLectures(State.lectures.filter(l => l.title.toLowerCase().includes(q)));
}

function makeQuizFromLec(id) {
  const sel = document.getElementById('qzLecSel');
  if (sel) sel.value = id;
  nav('quiz');
}

/* ── LIVE SESSIONS (Teacher) ─────────────────────────────── */
function openCreateSession() {
  const panel = document.getElementById('createSessPanel');
  const titleInput = document.getElementById('sessTitle');
  if (panel) panel.classList.remove('hidden');
  if (titleInput) titleInput.focus();
}

function closeCreateSession() {
  const panel = document.getElementById('createSessPanel');
  if (panel) panel.classList.add('hidden');
}

async function createSession() {
  const titleEl = document.getElementById('sessTitle');
  const courseEl = document.getElementById('sessCourse');
  const btn = document.getElementById('createSessBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoader = btn?.querySelector('.btn-loader');

  const title = (titleEl?.value || '').trim() || 'Live Lecture';
  const course = (courseEl?.value || '').trim() || null;

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');

  try {
    const res = await api.createSession(title, course);
    State.activeSession = { id: res.session_id, title };
    State.txCount = 0;

    // Join via socket
    if (socketClient.connected) socketClient.joinSession(res.session_id);

    // Show active session UI
    const activeControl = document.getElementById('activeSessControl');
    const activeTitle = document.getElementById('activeSessTitle');
    const activeId = document.getElementById('activeSessId');
    const transcript = document.getElementById('teacherTranscript');

    if (activeControl) activeControl.classList.remove('hidden');
    if (activeTitle) activeTitle.textContent = title;
    if (activeId) activeId.textContent = 'ID: ' + res.session_id;
    if (transcript) transcript.innerHTML = '<div class="tx-empty">Waiting for speech…</div>';

    closeCreateSession();

    // Update badge
    const badge = document.getElementById('activeSessBadge');
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = '1';
    }

    toast(`Session "${title}" started!`, 'success');
  } catch (e) {
    toast(e.message || 'Failed to create session', 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
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

    const activeControl = document.getElementById('activeSessControl');
    const badge = document.getElementById('activeSessBadge');
    if (activeControl) activeControl.classList.add('hidden');
    if (badge) badge.style.display = 'none';

    toast('Session ended', 'inf');
    loadOtherSessions();
  } catch (e) {
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
  const speaker = escHtml(data?.speaker || 'Unknown');
  const text = escHtml(data?.text || '');
  const time = formatTime(data?.timestamp);
  entry.innerHTML = `
    <span class="tx-sp ${speaker}">${speaker}</span>
    <span class="tx-text">${text}</span>
    <span class="tx-time">${time}</span>
  `;
  panel.appendChild(entry);
  panel.scrollTop = panel.scrollHeight;

  const cnt = document.getElementById('txCount');
  if (cnt) cnt.textContent = `${State.txCount} entr${State.txCount === 1 ? 'y' : 'ies'}`;
}

async function loadOtherSessions() {
  const list = document.getElementById('otherSessList');
  if (!list) return;
  try {
    const sessions = await api.getSessions();
    const others = sessions.filter(s => s.id !== State.activeSession?.id && s.session_id !== State.activeSession?.id);
    if (!others.length) {
      list.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">No other active sessions.</span>';
      return;
    }
    list.innerHTML = others.map(s => `
      <div class="glass sess-card">
        <div class="live-dot"></div>
        <div class="sess-info">
          <div class="sess-title">${escHtml(s.title || 'Live Session')}</div>
          <div class="sess-id">${(s.id || s.session_id || '').substring(0, 12)}…</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<span style="font-family:var(--fm);font-size:.72rem;color:var(--magenta)">${e.message || 'Error'}</span>`;
  }
}

/* ── QUIZ CREATOR ────────────────────────────────────────── */
function populateQuizLecDropdown() {
  const sel = document.getElementById('qzLecSel');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— choose —</option>';
  State.lectures.forEach(l => {
    const o = document.createElement('option');
    o.value = l.id;
    o.textContent = l.title;
    sel.appendChild(o);
  });
  if (current) sel.value = current;
}

async function teacherGenerateQuiz() {
  const lecId = document.getElementById('qzLecSel')?.value;
  const num = parseInt(document.getElementById('qzNumSel')?.value || '5');
  const diff = document.getElementById('qzDiffSel')?.value || 'medium';
  if (!lecId) { toast('Select a lecture first', 'error'); return; }

  const btn = document.getElementById('qzGenBtn');
  const btnText = btn?.querySelector('.btn-text');
  const btnLoader = btn?.querySelector('.btn-loader');

  if (btn) btn.disabled = true;
  if (btnText) btnText.classList.add('hidden');
  if (btnLoader) btnLoader.classList.remove('hidden');

  try {
    const res = await api.generateQuiz(lecId, num, diff);
    State.quizData = res;
    renderTeacherQuiz(res.questions);
    const preview = document.getElementById('qzPreviewWrap');
    if (preview) preview.classList.remove('hidden');
    toast(`${res.questions.length} questions generated!`, 'success');
  } catch (e) {
    toast(e.message || 'Quiz generation failed', 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (btnText) btnText.classList.remove('hidden');
    if (btnLoader) btnLoader.classList.add('hidden');
  }
}

function renderTeacherQuiz(questions) {
  const wrap = document.getElementById('qzContent');
  if (!wrap) return;
  const letters = ['A', 'B', 'C', 'D'];
  wrap.innerHTML = questions.map((q, qi) => {
    const opts = q.options.map((o, oi) => `
      <div class="opt ${oi === q.correct ? 'corr' : ''}" style="cursor:default">
        <span class="opt-letter">${letters[oi]}</span>
        ${escHtml(o)}
        ${oi === q.correct ? ' ✓' : ''}
      </div>
    `).join('');
    return `<div class="glass quiz-q">
      <div class="q-num">Q${qi + 1}</div>
      <div class="q-text">${escHtml(q.question)}</div>
      <div class="opts">${opts}</div>
      <div class="quiz-exp show">${escHtml(q.explanation || '')}</div>
    </div>`;
  }).join('');
}

function exportQuizJSON() {
  if (!State.quizData) return;
  const json = JSON.stringify(State.quizData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'oris_quiz.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Quiz exported as JSON', 'success');
}

function resetTeacherQuiz() {
  State.quizData = null;
  const content = document.getElementById('qzContent');
  const preview = document.getElementById('qzPreviewWrap');
  if (content) content.innerHTML = '';
  if (preview) preview.classList.add('hidden');
}

/* ── ANALYTICS ───────────────────────────────────────────── */
async function loadAnalytics() {
  try {
    const h = await api.health();

    const aLectures = document.getElementById('aLectures');
    const aSessions = document.getElementById('aSessions');
    const aLLM = document.getElementById('aLLM');
    const aDB = document.getElementById('aDB');

    if (aLectures) aLectures.textContent = State.lectures.length || '—';

    let sessionCount = '—';
    try {
      const sessions = await api.getSessions();
      sessionCount = sessions.length;
    } catch {}
    if (aSessions) aSessions.textContent = sessionCount;

    if (aLLM) {
      aLLM.textContent = h.llm ? 'ONLINE' : 'LOADING';
      aLLM.className = `stat-val ${h.llm ? 'grn' : 'mag'}`;
    }
    if (aDB) {
      aDB.textContent = h.db ? 'ONLINE' : 'ERROR';
      aDB.className = `stat-val ${h.db ? 'grn' : 'mag'}`;
    }

    const det = document.getElementById('healthDetails');
    if (det) {
      det.innerHTML = `
        <div class="prog-bar-row">
          <span class="prog-bar-label">LLM (Qwen)</span>
          <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.llm ? 100 : 20}%"></div></div>
          <span class="prog-bar-val" style="color:${h.llm ? 'var(--green)' : 'var(--magenta)'}">${h.llm ? 'OK' : 'WAIT'}</span>
        </div>
        <div class="prog-bar-row">
          <span class="prog-bar-label">STT (Whisper)</span>
          <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.stt ? 100 : 0}%"></div></div>
          <span class="prog-bar-val" style="color:${h.stt ? 'var(--green)' : 'var(--magenta)'}">${h.stt ? 'OK' : 'N/A'}</span>
        </div>
        <div class="prog-bar-row">
          <span class="prog-bar-label">Database</span>
          <div class="prog-bar-track"><div class="prog-bar-fill" style="width:${h.db ? 100 : 0}%"></div></div>
          <span class="prog-bar-val" style="color:${h.db ? 'var(--green)' : 'var(--magenta)'}">${h.db ? 'OK' : 'ERR'}</span>
        </div>
        <div style="font-family:var(--fm);font-size:.65rem;color:var(--text3);margin-top:.25rem">
          Formats: ${(h.formats || []).join(' · ')} · Last checked: ${new Date().toLocaleTimeString()}
        </div>
      `;
    }

    // Lecture list
    const lecEl = document.getElementById('analyticsLecList');
    if (lecEl) {
      if (State.lectures.length) {
        lecEl.innerHTML = State.lectures.slice(0, 8).map(l => `
          <div style="display:flex;align-items:center;gap:.75rem;padding:.45rem 0;border-bottom:1px solid var(--border)">
            <span class="lec-badge ${({ pdf: 'b-pdf', docx: 'b-docx', pptx: 'b-pptx', txt: 'b-text', md: 'b-text' }[l.file_type] || 'b-text')}" style="margin:0">${(l.file_type || 'doc').toUpperCase()}</span>
            <span style="flex:1;font-size:.82rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(l.title)}</span>
            <span style="font-family:var(--fm);font-size:.62rem;color:var(--text3)">${formatDate(l.created_at)}</span>
          </div>
        `).join('');
      } else {
        lecEl.innerHTML = '<span style="font-family:var(--fm);font-size:.72rem;color:var(--text2)">No lectures yet.</span>';
      }
    }
  } catch (e) {
    toast('Analytics fetch failed: ' + (e.message || 'Unknown error'), 'error');
  }
}