// ============================================================
// O.R.I.S. Frontend Config (runtime, no build step)
// ============================================================

/* global window, localStorage */

const CONFIG = {
  BACKEND_KEY: 'oris_backend_url',
  TOKEN_KEY: 'oris_token',
  USER_KEY: 'oris_user',
  QUIZ_HISTORY_KEY: 'oris_quiz_history',
  BACKEND_URL: '',
};

function normalizeBackendUrl(url) {
  const v = (url || '').trim();
  if (!v) return '';
  // remove trailing slash to avoid double slashes in requests
  return v.replace(/\/+$/, '');
}

function getBackendUrl() {
  if (CONFIG.BACKEND_URL) return CONFIG.BACKEND_URL;
  const saved = localStorage.getItem(CONFIG.BACKEND_KEY) || '';
  CONFIG.BACKEND_URL = normalizeBackendUrl(saved);
  return CONFIG.BACKEND_URL;
}

function setBackendUrl(url) {
  const norm = normalizeBackendUrl(url);
  CONFIG.BACKEND_URL = norm;
  if (norm) localStorage.setItem(CONFIG.BACKEND_KEY, norm);
  else localStorage.removeItem(CONFIG.BACKEND_KEY);
  return norm;
}

// Initialize once at load
getBackendUrl();
