// ============================================================
// Mock API implementation (offline mode)
// ============================================================

/* global localStorage, CONFIG */

const LS = {
  LECTURES: 'oris_mock_lectures',
  SESSIONS: 'oris_mock_sessions',
};

function nowIso() {
  return new Date().toISOString();
}

function rid(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function seedIfNeeded() {
  const lectures = loadJson(LS.LECTURES, null);
  if (!lectures) {
    saveJson(LS.LECTURES, [
      { id: 'lec_mock_1', title: 'Introduction to Neural Networks', file_type: 'pdf', created_at: nowIso() },
      { id: 'lec_mock_2', title: 'Backpropagation Cheat Sheet', file_type: 'txt', created_at: nowIso() },
      { id: 'lec_mock_3', title: 'Gradient Descent Slides', file_type: 'pptx', created_at: nowIso() },
    ]);
  }
  const sessions = loadJson(LS.SESSIONS, null);
  if (!sessions) {
    saveJson(LS.SESSIONS, [
      { session_id: 'sess_mock_1', id: 'sess_mock_1', title: 'Mock Live Session', status: 'active' },
    ]);
  }
}

export async function mockRequest(path, { method = 'GET', body, token } = {}) {
  seedIfNeeded();

  // ---- health ----
  if (path === '/health' && method === 'GET') {
    return { llm: true, stt: false, db: true, formats: ['pdf', 'docx', 'pptx', 'txt', 'md'] };
  }

  // ---- auth ----
  if (path === '/auth/login' && method === 'POST') {
    const username = body?.username || 'demo';
    const role = username.toLowerCase().includes('teach') ? 'teacher' : 'student';
    return {
      access_token: 'mock.jwt.token',
      user: { id: 'u_mock', username, email: `${username}@mock.local`, role, learning_style: 'visual' },
    };
  }
  if (path === '/auth/register' && method === 'POST') {
    return { ok: true };
  }

  // ---- require token for protected routes (soft) ----
  if (!token && !path.startsWith('/auth/') && path !== '/health') {
    throw new Error('Not authenticated (mock)');
  }

  // ---- lectures ----
  if (path === '/lectures' && method === 'GET') {
    return loadJson(LS.LECTURES, []);
  }

  if (path.startsWith('/lectures/upload') && method === 'POST') {
    const lectures = loadJson(LS.LECTURES, []);
    const title = body?.title || body?.filename || 'Mock Upload';
    const fileType = (body?.filename || '').split('.').pop()?.toLowerCase() || 'pdf';
    const lec = { id: rid('lec'), title, file_type: fileType, created_at: nowIso() };
    lectures.unshift(lec);
    saveJson(LS.LECTURES, lectures);
    return { ...lec, rag: { chunks: 42 } };
  }

  // ---- sessions ----
  if (path === '/sessions' && method === 'GET') {
    return loadJson(LS.SESSIONS, []);
  }
  if (path === '/sessions' && method === 'POST') {
    const sessions = loadJson(LS.SESSIONS, []);
    const s = { session_id: rid('sess'), id: rid('sess'), title: body?.title || 'Live Session', status: 'active' };
    sessions.unshift(s);
    saveJson(LS.SESSIONS, sessions);
    return { session_id: s.session_id };
  }
  if (path.startsWith('/sessions/') && method === 'DELETE') {
    const sessions = loadJson(LS.SESSIONS, []);
    const id = decodeURIComponent(path.split('/').pop() || '');
    saveJson(LS.SESSIONS, sessions.filter((s) => s.session_id !== id && s.id !== id));
    return null;
  }

  // ---- quiz ----
  if (path === '/quiz/generate' && method === 'POST') {
    const n = Math.max(1, Math.min(20, Number(body?.num_questions || 5)));
    const questions = Array.from({ length: n }).map((_, i) => ({
      question: `Mock question ${i + 1}: What does backpropagation compute?`,
      options: ['Gradients', 'Loss', 'Accuracy', 'Weights only'],
      correct: 0,
      explanation: 'Backpropagation computes gradients of the loss with respect to parameters.',
    }));
    return { lecture_id: body?.lecture_id || 'lec_mock_1', questions, difficulty: body?.difficulty || 'medium' };
  }
  if (path === '/quiz/submit' && method === 'POST') {
    const q = body?.questions || [];
    const a = body?.answers || [];
    let correct = 0;
    q.forEach((qq, i) => {
      if (Number(a[i]) === Number(qq.correct)) correct += 1;
    });
    const score = q.length ? Math.round((correct / q.length) * 100) : 0;
    const hist = loadJson(CONFIG.QUIZ_HISTORY_KEY, []);
    hist.unshift({ ts: Date.now(), score, lecture_id: body?.lecture_id || 'lec_mock_1' });
    saveJson(CONFIG.QUIZ_HISTORY_KEY, hist.slice(0, 50));
    return { score, correct, total: q.length };
  }

  throw new Error(`Mock route not implemented: ${method} ${path}`);
}

export async function mockAskStream(payload, onChunk, onDone, onError) {
  try {
    const msg = (payload?.message || '').trim();
    const resp =
      `Mock mode response.\n\n` +
      `You asked: "${msg || '(empty)'}"\n\n` +
      `Tip: Set NGROK_URL in static/js/config.js to use the real backend.`;
    const parts = resp.split(/(\s+)/);
    let i = 0;
    const t = setInterval(() => {
      if (i >= parts.length) {
        clearInterval(t);
        onDone?.();
        return;
      }
      onChunk?.(parts[i++]);
    }, 30);
  } catch (e) {
    onError?.(e);
  }
}