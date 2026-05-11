// ============================================================
// O.R.I.S. REST API client + mock mode fallback
// ============================================================

/* global fetch, CONFIG, getApiBaseUrl, isMockMode, localStorage */

const api = (() => {
  let _token = localStorage.getItem(CONFIG.TOKEN_KEY) || '';
  let _mockImpl = null;

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
    return getApiBaseUrl();
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

  function withTimeout(ms) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(new Error('timeout')), ms);
    return { signal: ctrl.signal, done: () => clearTimeout(id) };
  }

  async function realFetch(url, init, timeoutMs) {
    const { signal, done } = withTimeout(timeoutMs);
    try {
      return await fetch(url, { ...init, signal });
    } finally {
      done();
    }
  }

  async function request(path, opts = {}) {
    const {
      method = 'GET',
      headers = {},
      body,
      query,
      auth = true,
      json = true,
      timeoutMs = CONFIG.FETCH_TIMEOUT_MS,
    } = opts;

    // Mock route (manual toggle OR automatic fallback)
    if (isMockMode()) {
      if (!_mockImpl) _mockImpl = await import('./mock.js');
      return await _mockImpl.mockRequest(path, { method, body, query, token: _token });
    }

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

    let resp;
    try {
      resp = await realFetch(
        url.toString(),
        { method, headers: h, body: json && body != null ? JSON.stringify(body) : body },
        timeoutMs
      );
    } catch (e) {
      throw new Error(e?.message || 'Network error');
    }

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

  function uploadLecture(file, title, course_id) {
    // No streaming progress without XHR; we keep a simple indeterminate animation in UI.
    // In mock mode we return quickly with a synthetic response.
    if (isMockMode()) {
      return request('/lectures/upload', {
        method: 'POST',
        json: false,
        body: { filename: file?.name || 'mock.pdf', title, course_id },
      });
    }

    const params = new URLSearchParams();
    if (title) params.append('title', title);
    if (course_id) params.append('course_id', course_id);
    const url = baseUrl() + '/lectures/upload' + (params.toString() ? `?${params.toString()}` : '');

    const fd = new FormData();
    fd.append('file', file);
    return realFetch(
      url,
      { method: 'POST', headers: _token ? { Authorization: `Bearer ${_token}` } : {}, body: fd },
      CONFIG.FETCH_TIMEOUT_MS * 2
    ).then(async (resp) => {
      if (!resp.ok) throw new Error(await parseError(resp));
      return await resp.json();
    });
  }

  async function askStream(payload, onChunk, onDone, onError) {
    if (isMockMode()) {
      if (!_mockImpl) _mockImpl = await import('./mock.js');
      return await _mockImpl.mockAskStream(payload, onChunk, onDone, onError);
    }
    try {
      const url = baseUrl() + '/ask/stream';
      const resp = await realFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: _token ? `Bearer ${_token}` : '',
        },
        body: JSON.stringify(payload),
      }, CONFIG.FETCH_TIMEOUT_MS * 2);
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
    uploadLecture,
    askStream,
  };
})();
