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

  // ── ADDITIONAL CONVENIENCE WRAPPERS ────────────────────────

  async function getLectures()           { return get('/lectures'); }
  async function getSessions()           { return get('/sessions'); }
  async function endSession(sid)         { return del('/sessions/' + sid); }

  async function createSession(title, courseId) {
    return post('/sessions', { title, course_id: courseId || null });
  }

  async function uploadLecture(file, title, courseId) {
    const form = new FormData();
    form.append('file', file);
    const qs = new URLSearchParams();
    if (title)    qs.set('title',     title);
    if (courseId) qs.set('course_id', courseId);
    return upload('/lectures/upload?' + qs.toString(), form);
  }

  // ── Quiz endpoints (Cell 6 v2 modes) ───────────────────────

  async function generateQuiz(lectureId, numQuestions, difficulty, bloomLevel) {
    return post('/quiz/generate', {
      lecture_id:    lectureId,
      num_questions: numQuestions || 5,
      difficulty:    difficulty   || 'medium',
      bloom_level:   bloomLevel   || null,
    });
  }

  async function generateTrueFalse(lectureId, numQuestions) {
    return post('/quiz/generate', {
      lecture_id:    lectureId,
      num_questions: numQuestions || 5,
      quiz_type:     'true_false',
    });
  }

  async function generateFillBlank(lectureId, numQuestions) {
    return post('/quiz/generate', {
      lecture_id:    lectureId,
      num_questions: numQuestions || 5,
      quiz_type:     'fill_blank',
    });
  }

  async function generateMixedQuiz(lectureId, numQuestions, types) {
    return post('/quiz/generate', {
      lecture_id:    lectureId,
      num_questions: numQuestions || 10,
      quiz_type:     'mixed',
      types:         types || ['mcq', 'true_false', 'fill_blank'],
    });
  }

  async function submitQuiz(lectureId, questions, answers, difficulty) {
    return post('/quiz/submit', {
      lecture_id: lectureId || null,
      questions,
      answers,
      difficulty: difficulty || 'medium',
    });
  }

  // ── New Cell 6 v2 endpoints ────────────────────────────────

  async function generateFlashcards(lectureId, numCards) {
    return post('/ai/flashcards', {
      lecture_id: lectureId,
      num_cards:  numCards || 10,
    });
  }

  async function generateStudyPlan(topic, lectureId, durationDays, dailyHours) {
    return post('/ai/study-plan', {
      topic,
      lecture_id:    lectureId   || null,
      duration_days: durationDays || 7,
      daily_hours:   dailyHours   || 2,
    });
  }

  async function generateConceptMap(lectureId, message) {
    return post('/ask', {
      message:    message || 'Create a concept map for this lecture.',
      mode:       'concept_map',
      lecture_id: lectureId || null,
    });
  }

  async function generateDebate(topic, lectureId) {
    return post('/ask', {
      message:    `Provide a balanced debate analysis for: ${topic}`,
      mode:       'debate',
      lecture_id: lectureId || null,
    });
  }

  async function writeEssay(prompt, lectureId, length) {
    return post('/ask', {
      message:    `${length === 'short' ? 'Write a short 3-paragraph essay' : length === 'long' ? 'Write a detailed 7+ paragraph essay' : 'Write a full 5-paragraph essay'}. Essay question: ${prompt}`,
      mode:       'essay',
      lecture_id: lectureId || null,
    });
  }

  async function socraticGuide(topic, studentResponse, sessionId) {
    return post('/ask', {
      message:    `Topic: ${topic}${studentResponse ? `\nMy current understanding: ${studentResponse}` : ''}\n\nGuide me to the answer through questions.`,
      mode:       'socratic',
      session_id: sessionId || null,
    });
  }

  return { get, post, put, delete: del, patch, upload, stream, health,
    getToken,
    getLectures, getSessions, createSession, endSession, uploadLecture,
    generateQuiz, generateTrueFalse, generateFillBlank, generateMixedQuiz,
    submitQuiz,
    generateFlashcards, generateStudyPlan,
    generateConceptMap, generateDebate, writeEssay, socraticGuide,
  };

})();

window.API = API;