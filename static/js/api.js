// ============================================================
// O.R.I.S. REST API client
// ============================================================

/* global fetch, CONFIG, getBackendUrl, localStorage */

const api = (() => {
  let _token = localStorage.getItem(CONFIG.TOKEN_KEY) || '';

  function setToken(t) {
    _token = t || '';
    if (_token) localStorage.setItem(CONFIG.TOKEN_KEY, _token);
    else localStorage.removeItem(CONFIG.TOKEN_KEY);
  }

  function clearToken() {
    setToken('');
  }

  function getToken() {
    return _token;
  }

  function baseUrl() {
    const b = getBackendUrl();
    if (!b) throw new Error('Backend URL not configured');
    return b;
  }

  async function parseError(resp) {
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await resp.json().catch(() => ({}));
      return j?.detail || j?.message || `HTTP ${resp.status}`;
    }
    const t = await resp.text().catch(() => '');
    return t || `HTTP ${resp.status}`;
  }

  async function request(path, opts = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      query,
      auth = true,
      json = true,
    } = opts;

    const url = new URL(baseUrl() + path);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        url.searchParams.set(k, String(v));
      });
    }

    const h = { ...headers };
    if (json && body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (auth && _token) h.Authorization = `Bearer ${_token}`;

    const resp = await fetch(url.toString(), {
      method,
      headers: h,
      body: json && body != null ? JSON.stringify(body) : body,
    });

    if (!resp.ok) {
      throw new Error(await parseError(resp));
    }

    if (resp.status === 204) return null;
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return await resp.json();
    return await resp.text();
  }

  // ---- Public API ----
  function health() {
    return request('/health', { auth: false });
  }

  function login(username, password) {
    return request('/auth/login', { method: 'POST', auth: false, body: { username, password } });
  }

  function register(payload) {
    return request('/auth/register', { method: 'POST', auth: false, body: payload });
  }

  function getLectures() {
    return request('/lectures');
  }

  function getSessions() {
    return request('/sessions');
  }

  function createSession(title, course_id) {
    return request('/sessions', { method: 'POST', body: { title, course_id: course_id || null } });
  }

  function endSession(session_id) {
    return request(`/sessions/${encodeURIComponent(session_id)}`, { method: 'DELETE' });
  }

  function generateQuiz(lecture_id, num_questions, difficulty) {
    return request('/quiz/generate', {
      method: 'POST',
      body: { lecture_id, num_questions, difficulty },
    });
  }

  function submitQuiz(lecture_id, questions, answers, difficulty) {
    return request('/quiz/submit', {
      method: 'POST',
      body: { lecture_id, questions, answers, difficulty },
    });
  }

  async function askStream(payload, onChunk, onDone, onError) {
    try {
      const url = baseUrl() + '/ask/stream';
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: _token ? `Bearer ${_token}` : '',
        },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) throw new Error(await parseError(resp));
      if (!resp.body) throw new Error('Streaming not supported by browser');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) onChunk?.(chunk);
      }
      onDone?.();
    } catch (e) {
      onError?.(e);
    }
  }

  return {
    request,
    setToken,
    clearToken,
    getToken,
    health,
    login,
    register,
    getLectures,
    getSessions,
    createSession,
    endSession,
    generateQuiz,
    submitQuiz,
    askStream,
  };
})();
