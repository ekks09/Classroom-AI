/* ============================================================
   js/api.js — REST API client
  
   ============================================================ */

'use strict';

/* global CONFIG, getApiBaseUrl, getApiPrefix, Auth */

const API = (() => {

  // ── CORE FETCH ────────────────────────────────────────────

  async function request(method, path, body, opts = {}) {

    const base    = getApiBaseUrl();
    const prefix  = getApiPrefix();
    const url     = base + prefix + path;
    const timeout = opts.timeout || CONFIG.FETCH_TIMEOUT_MS;

    const headers = {
      'ngrok-skip-browser-warning': 'true',  // bypass ngrok browser warning
      ...opts.headers,
    };

    const token = Auth.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let bodyStr;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      bodyStr = JSON.stringify(body);
    }

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeout);

    try {
      const res = await fetch(url, {
        method,
        headers,
        body:   bodyStr || (body instanceof FormData ? body : undefined),
        signal: ctrl.signal,
      });

      clearTimeout(tid);

      if (res.status === 401) {
        Auth.logout();
        throw new Error('Session expired. Please log in again.');
      }

      // Fix [2]: 403 should not logout — show permission error
      if (res.status === 403) {
        throw new Error('Permission denied. Insufficient role.');
      }

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const j = await res.json();
          errMsg = j.detail || j.message || errMsg;
        } catch { /* empty response */ }
        throw new Error(errMsg);
      }

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await res.json();
      return await res.text();

    } catch (e) {
      clearTimeout(tid);
      if (e.name === 'AbortError') {
        throw new Error(`Request timed out (${timeout}ms): ${path}`);
      }
      throw e;
    }
  }

  function get(path, opts)         { return request('GET',    path, null, opts); }
  function post(path, body, opts)  { return request('POST',   path, body, opts); }
  function put(path, body, opts)   { return request('PUT',    path, body, opts); }
  function del(path, opts)         { return request('DELETE', path, null, opts); }
  function patch(path, body, opts) { return request('PATCH',  path, body, opts); }

  // Fix [4]: upload timeout 180s — Colab RAG ingest takes time
  function upload(path, form, opts) {
    return request('POST', path, form, { ...opts, timeout: 180000 });
  }

  // ── STREAMING — Fix [1] ───────────────────────────────────
  // Your backend uses:
  //   return StreamingResponse(generator(), media_type="text/plain")
  // This sends raw text chunks — NOT SSE format.
  // The old parser looked for "data: " prefix and found nothing.

  async function* stream(path, body) {
    const base   = getApiBaseUrl();
    const prefix = getApiPrefix();
    const url    = base + prefix + path;
    const token  = Auth.getToken();

    const headers = {
      'Content-Type':               'application/json',
      'ngrok-skip-browser-warning': 'true',
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(url, {
      method:  'POST',
      headers,
      body:    JSON.stringify(body),
    });

    if (res.status === 401) { Auth.logout(); throw new Error('Session expired.'); }
    if (!res.ok) throw new Error(`Stream HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    // Fix [1]: plain text streaming — yield every non-empty chunk
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk) yield { chunk };  // { chunk: "text..." }
    }
  }

  // Fix [3]: health check convenience method
  async function health() {
    try {
      const data = await get('/health', { timeout: 8000 });
      return data;
    } catch {
      return null;
    }
  }

  return { get, post, put, delete: del, patch, upload, stream, health };

})();

window.API = API;