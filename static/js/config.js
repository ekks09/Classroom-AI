// ============================================================
// O.R.I.S. Frontend Config — Render + ngrok ready
// ============================================================
const DEFAULT_BACKEND_URL = 'https://intersystematic-yolonda-gymnogenous.ngrok-free.dev';
const DEFAULT_API_PREFIX = '';  // ngrok doesn't need /api prefix typically

const CONFIG = {
  BACKEND_KEY:      'oris_backend_url',
  API_PREFIX_KEY:   'oris_api_prefix',
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
  // Allow overriding backend without editing code:
  // - saved: localStorage.oris_backend_url
  // - one-time: ?backend=https://...
  let candidate = '';
  try {
    const u = new URL(window.location.href);
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

  const base = normalizeBaseUrl(candidate || DEFAULT_BACKEND_URL);
  if (!base) throw new Error('Backend URL is not set (config.js)');
  return base;
}

function normalizeApiPrefix(prefix) {
  const v = (prefix || '').trim();
  if (!v) return '';
  if (v === '/' || v.toLowerCase() === 'none') return '';
  return '/' + v.replace(/^\/+/, '').replace(/\/+$/, '');
}

function getApiPrefix() {
  let candidate = '';
  try {
    const u = new URL(window.location.href);
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
  return normalizeApiPrefix(candidate || DEFAULT_API_PREFIX);
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