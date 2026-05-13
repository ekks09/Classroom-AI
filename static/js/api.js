// ============================================================
// O.R.I.S. REST API client + mock mode fallback
// ============================================================

/* global fetch, CONFIG, getApiBaseUrl, getApiPrefix, isMockMode, localStorage, Logger */

const api = (() => {
  let _token = localStorage.getItem(CONFIG.TOKEN_KEY) || '';
  let _mockImpl = null;

  // Helper function to get ngrok headers
  function getNgrokHeaders() {
    return { 'ngrok-skip-browser-warning': 'true' };
  }

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

  // ── Error parsing ───────────────────────────────────────────
  async function parseError(resp) {
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const j = await resp.json().catch(() => ({}));
      return j?.detail || j?.message || `HTTP ${resp.status}`;
    }
    const t = await resp.text().catch(() => '');
    return t || `HTTP ${resp.status}`;
  }

  // ── Timeout wrapper ─────────────────────────────────────────
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

  // ── Build headers with ngrok bypass ──────────────────────────
  function buildHeaders(headers = {}, json = true, includeAuth = true) {
    const h = { ...headers };

    // Always include ngrok bypass header for free tier
    Object.assign(h, getNgrokHeaders());

    if (json && !h['Content-Type']) {
      h['Content-Type'] = 'application/json';
    }

    if (includeAuth && _token) {
      h.Authorization = `Bearer ${_token}`;
    }

    return h;
  }

  // ── Core request ────────────────────────────────────────────
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

    // ── Mock mode ─────────────────────────────────────────────
    if (isMockMode()) {
      if (!_mockImpl) {
        try {
          _mockImpl = await import('./mock.js');
        } catch (e) {
          Logger?.warn('mock_not_available', { error: e.message });
          throw new Error('Mock mode not available');
        }
      }
      return await _mockImpl.mockRequest(path, { method, body, query, token: _token });
    }

    // ── Real backend ──────────────────────────────────────────
    const apiPrefix = getApiPrefix(); // Use actual prefix (now /api)
    const baseUrl = getApiBaseUrl();
    const url = new URL(baseUrl + apiPrefix + path);
    if (query) {
      Object.entries(query).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        url.searchParams.set(k, String(v));
      });
    }

    const h = buildHeaders(headers, json, auth);

    let resp;
    try {
      resp = await realFetch(
        url.toString(),
        {
          method,
          headers: h,
          body: json && body != null ? JSON.stringify(body) : body,
        },
        timeoutMs
      );
    } catch (e) {
      try {
        Logger?.error('api.network_error', {
          path,
          method,
          message: e?.message,
        });
      } catch {}
      throw new Error(e?.message || 'Network error');
    }

    if (!resp.ok) {
      const msg = await parseError(resp);
      try {
        Logger?.warn('api.http_error', {
          path,
          method,
          status: resp.status,
          message: msg,
        });
      } catch {}
      throw new Error(msg);
    }

    if (resp.status === 204) return null;

    const ct = resp.headers.get('content-type') || '';
    return ct.includes('application/json') ? resp.json() : resp.text();
  }

  // ── Public API endpoints ────────────────────────────────────
  function health() {
    return request('/health', { auth: false });
  }

  function login(username, password) {
    return request('/auth/login', {
      method: 'POST',
      auth: false,
      body: { username, password },
    });
  }

  function register(payload) {
    return request('/auth/register', {
      method: 'POST',
      auth: false,
      body: payload,
    });
  }

  function getCourses() {
    return request('/courses', { auth: false });
  }

  function getLectures(courseId) {
    return request('/lectures', {
      query: courseId ? { course_id: courseId } : undefined,
    });
  }

  function getSessions() {
    return request('/sessions');
  }

  function createSession(title, course_id) {
    return request('/sessions', {
      method: 'POST',
      body: { title, course_id: course_id || null },
    });
  }

  function endSession(session_id) {
    return request(`/sessions/${encodeURIComponent(session_id)}`, {
      method: 'DELETE',
    });
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

    const apiPrefix = getApiPrefix();
    const baseUrl = getApiBaseUrl();
    const url = new URL(baseUrl + apiPrefix + '/lectures/upload');
    if (params.toString()) {
      url.searchParams = params;
    }

    const fd = new FormData();
    fd.append('file', file);

    const headers = {
      ...getNgrokHeaders(),
    };
    if (_token) {
      headers.Authorization = `Bearer ${_token}`;
    }

    return realFetch(
      url,
      { method: 'POST', headers, body: fd },
      CONFIG.FETCH_TIMEOUT_MS * 3
    ).then(async (resp) => {
      if (!resp.ok) throw new Error(await parseError(resp));
      return resp.json();
    });
  }

  async function askStream(payload, onChunk, onDone, onError) {
    if (isMockMode()) {
      if (!_mockImpl) {
        try {
          _mockImpl = await import('./mock.js');
        } catch (e) {
          onError?.(e);
          return;
        }
      }
      return await _mockImpl.mockAskStream(payload, onChunk, onDone, onError);
    }

    try {
      const url = new URL(getApiBaseUrl() + getApiPrefix() + '/ask/stream');
      const h = buildHeaders({}, true, true);

      const resp = await realFetch(
        url.toString(),
        {
          method: 'POST',
          headers: h,
          body: JSON.stringify(payload),
        },
        CONFIG.FETCH_TIMEOUT_MS * 3
      );

      if (!resp.ok) throw new Error(await parseError(resp));
      if (!resp.body) throw new Error('Streaming not supported');

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
    getCourses,
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