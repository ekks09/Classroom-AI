'use strict';
const DEFAULT_BACKEND_URL = 'https://intersystematic-yolonda-gymnogenous.ngrok-free.dev';

const DEFAULT_API_PREFIX = '';

const CONFIG = {
  BACKEND_KEY:      'oris_backend_url',
  API_PREFIX_KEY:   'oris_api_prefix',
  TOKEN_KEY:        'oris_token',
  USER_KEY:         'oris_user',
  QUIZ_HISTORY_KEY: 'oris_quiz_history',
  MOCK_MODE_KEY:    'oris_mock_mode',
  FETCH_TIMEOUT_MS: 15000,  // raised: Colab/ngrok adds latency
};

function normalizeBaseUrl(url) {
  const v = (url || '').trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

function getApiBaseUrl() {
  let candidate = '';
  try {
    const u  = new URL(window.location.href);
    const qp = (u.searchParams.get('backend') || '').trim();
    if (qp) {
      localStorage.setItem(CONFIG.BACKEND_KEY, normalizeBaseUrl(qp));
      u.searchParams.delete('backend');
      window.history.replaceState({}, '', u.toString());
    }
    candidate = localStorage.getItem(CONFIG.BACKEND_KEY) || '';
  } catch {
    candidate = localStorage.getItem(CONFIG.BACKEND_KEY) || '';
  }

  // Fix [3]: return empty string instead of throwing —
  // callers handle empty URL by enabling mock mode
  return normalizeBaseUrl(candidate || DEFAULT_BACKEND_URL);
}

function normalizeApiPrefix(prefix) {
  const v = (prefix || '').trim();
  if (!v || v === '/' || v.toLowerCase() === 'none') return '';
  return '/' + v.replace(/^\/+/, '').replace(/\/+$/, '');
}

function getApiPrefix() {
  let candidate = '';
  try {
    const u  = new URL(window.location.href);
    const qp = (u.searchParams.get('apiprefix') || '').trim();
    if (qp) {
      localStorage.setItem(CONFIG.API_PREFIX_KEY, normalizeApiPrefix(qp));
      u.searchParams.delete('apiprefix');
      window.history.replaceState({}, '', u.toString());
    }
    candidate = localStorage.getItem(CONFIG.API_PREFIX_KEY) || '';
  } catch {
    candidate = localStorage.getItem(CONFIG.API_PREFIX_KEY) || '';
  }
  // Fix [2]: default is '' not '/api'
  if (candidate === '') return normalizeApiPrefix(DEFAULT_API_PREFIX);
  return normalizeApiPrefix(candidate);
}

function isMockMode() {
  return (localStorage.getItem(CONFIG.MOCK_MODE_KEY) || '') === '1';
}

function setMockMode(enabled, reason = '') {
  localStorage.setItem(CONFIG.MOCK_MODE_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('mockmodechange', {
    detail: { enabled: !!enabled, reason }
  }));
}

function toggleMockMode() {
  setMockMode(!isMockMode(), 'manual');
}

// Expose as globals — referenced by api.js, auth.js, socket.js
window.CONFIG         = CONFIG;
window.getApiBaseUrl  = getApiBaseUrl;
window.getApiPrefix   = getApiPrefix;
window.isMockMode     = isMockMode;
window.setMockMode    = setMockMode;
window.toggleMockMode = toggleMockMode;