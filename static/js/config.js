// ============================================================
// O.R.I.S. Frontend Config — Vercel + ngrok ready
// ============================================================

/* global window, localStorage */

// 🔧 SET YOUR NGROK URL HERE (no trailing slash)
// Example: "https://xxxx.ngrok-free.app"
const NGROK_URL = 'https://intersystematic-yolonda-gymnogenous.ngrok-free.dev';

const CONFIG = {
  TOKEN_KEY:        'oris_token',
  USER_KEY:         'oris_user',
  QUIZ_HISTORY_KEY: 'oris_quiz_history',
  MOCK_MODE_KEY:    'oris_mock_mode',
  FETCH_TIMEOUT_MS: 12000,
};

function normalizeBaseUrl(url) {
  const v = (url || '').trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

function getApiBaseUrl() {
  const base = normalizeBaseUrl(NGROK_URL);
  if (!base) throw new Error('NGROK_URL is not set in static/js/config.js');
  return base;
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