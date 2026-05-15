/* ============================================================
   js/main.js — index.html login/register logic
   ============================================================ */
'use strict';

/* global CONFIG, API, Auth, isMockMode, setMockMode,
          getApiBaseUrl, getApiPrefix */

// ── HELPERS ───────────────────────────────────────────────────

function switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('loginCard')?.classList.toggle('hidden', !isLogin);
  document.getElementById('registerCard')?.classList.toggle('hidden', isLogin);
  document.getElementById('loginTab')?.classList.toggle('active', isLogin);
  document.getElementById('registerTab')?.classList.toggle('active', !isLogin);
  clearMsg();
}

function clearMsg() {
  ['authMsg', 'registerMsg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.classList.add('hidden'); }
  });
}

function showMsg(id, text, isError = true) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className   = `auth-msg ${isError ? 'auth-msg--err' : 'auth-msg--ok'}`;
  el.classList.remove('hidden');
}

function setBtnLoading(btnId, loading) {
  const btn    = document.getElementById(btnId);
  if (!btn) return;
  const text   = btn.querySelector('.btn-text');
  const loader = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  text?.classList.toggle('hidden', loading);
  if (loading) loader?.classList.remove('hidden');
  else         loader?.classList.add('hidden');
}

// [2][6] Role → page mapping
function redirectByRole(user) {
  if (user.role === 'student') {
    window.location.href = '/student.html';
  } else if (user.role === 'lecturer' || user.role === 'admin') {
    window.location.href = '/teacher.html';
  } else {
    window.location.href = '/student.html';
  }
}

// ── LOGIN ─────────────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();
  clearMsg();

  const username = document.getElementById('loginUser')?.value.trim();
  const password = document.getElementById('loginPass')?.value;

  if (!username || !password) {
    showMsg('authMsg', 'Username and password are required.');
    return;
  }

  setBtnLoading('loginBtn', true);

  try {
    // [1] Backend returns: { access_token, token_type, user }
    // user = { id, username, email, role, profile }
    const data = await API.post('/auth/login', { username, password });

    const token = data.access_token || data.token;
    const user  = data.user || { username, role: 'student' };

    if (!token) throw new Error('No token received from server.');

    Auth.setSession(token, user);
    showMsg('authMsg', 'Access granted. Redirecting…', false);

    setTimeout(() => redirectByRole(user), 400);

  } catch (err) {
    showMsg('authMsg', err.message || 'Authentication failed.');
    setBtnLoading('loginBtn', false);
  }
}

// ── REGISTER ──────────────────────────────────────────────────

async function handleRegister(e) {
  e.preventDefault();
  clearMsg();

  const username       = document.getElementById('registerUser')?.value.trim();
  const email          = document.getElementById('registerEmail')?.value.trim();
  const password       = document.getElementById('registerPass')?.value;
  const role           = document.getElementById('registerRole')?.value;     // "student" or "lecturer"
  const learning_style = document.getElementById('registerStyle')?.value || 'visual';

  if (!username || !email || !password) {
    showMsg('registerMsg', 'All fields are required.');
    return;
  }
  if (password.length < 8) {
    showMsg('registerMsg', 'Password must be at least 8 characters.');
    return;
  }

  setBtnLoading('registerBtn', true);

  try {
    // [3] POST /auth/register → { user_id, username, role }
    await API.post('/auth/register', { username, email, password, role, learning_style });

    showMsg('registerMsg', 'Account created! Logging you in…', false);

    // Auto-login
    setTimeout(async () => {
      try {
        const data  = await API.post('/auth/login', { username, password });
        const token = data.access_token || data.token;
        const user  = data.user || { username, role };
        Auth.setSession(token, user);
        redirectByRole(user);
      } catch {
        showMsg('registerMsg', 'Registered! Please log in.', false);
        switchTab('login');
        setBtnLoading('registerBtn', false);
      }
    }, 600);

  } catch (err) {
    showMsg('registerMsg', err.message || 'Registration failed.');
    setBtnLoading('registerBtn', false);
  }
}

// ── HEALTH / STATUS DOTS ──────────────────────────────────────

// [4] Backend /health returns { status:"ok", llm:bool, stt:bool, db:bool }
async function checkIndexHealth() {
  try {
    const data = await API.health();
    if (!data) return;

    const setDot = (id, ok) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = 'asr-dot ' + (ok ? 'dot--green' : 'dot--amber');
    };

    setDot('authLlmDot', data.llm === true);       // bool — is_ready
    setDot('authDbDot',  data.db  === true);
    setDot('authSysDot', data.status === 'ok');
  } catch { /* dots stay grey — backend not yet reachable */ }
}

// ── BOOT ─────────────────────────────────────────────────────

async function bootIndex() {
  const fill = document.getElementById('indexBootFill');
  const msg  = document.getElementById('indexBootMsg');
  const boot = document.getElementById('indexBoot');
  const page = document.getElementById('authPage');

  const steps = [
    [15,  'Initialising O.R.I.S. system…'],
    [35,  'Loading neural interface…'],
    [55,  'Establishing backend link…'],
    [75,  'Verifying session state…'],
    [90,  'Checking system health…'],
    [100, 'System ready.'],
  ];

  for (const [pct, text] of steps) {
    if (msg)  msg.textContent  = text;
    if (fill) fill.style.width = pct + '%';
    await new Promise(r => setTimeout(r, 260));
  }

  // [2][6] Already logged in — redirect immediately
  const user  = Auth.getUser();
  const token = Auth.getToken();
  if (user && token && !Auth.isTokenExpired(token)) {
    redirectByRole(user);
    return;
  }

  if (boot) boot.style.display = 'none';
  if (page) page.style.display = 'flex';

  // [5] Async health check — update status dots in background
  checkIndexHealth();
}

// ── TAB WIRING ────────────────────────────────────────────────

window.switchTab      = switchTab;
window.handleLogin    = handleLogin;
window.handleRegister = handleRegister;

document.addEventListener('DOMContentLoaded', bootIndex);