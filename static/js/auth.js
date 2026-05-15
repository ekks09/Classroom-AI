/* ============================================================
   js/auth.js — JWT auth helpers
   ============================================================ */

'use strict';

/* global CONFIG, API */

// ── Storage backend ───────────────────────────────────────────
// sessionStorage  → clears when tab / browser closes (active session)
// localStorage   → persists forever (use for "remember me" flow)
const _store = sessionStorage;

const Auth = (() => {

  function getToken() {
    return _store.getItem(CONFIG.TOKEN_KEY) || null;
  }

  function getUser() {
    try {
      const raw = _store.getItem(CONFIG.USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function setSession(token, user) {
    _store.setItem(CONFIG.TOKEN_KEY, token);
    _store.setItem(CONFIG.USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    _store.removeItem(CONFIG.TOKEN_KEY);
    _store.removeItem(CONFIG.USER_KEY);
  }

  // Fix [4]: call server logout to revoke JWT in RevocationStore
  async function logout() {
    const token = getToken();
    if (token) {
      try {
        await fetch(getApiBaseUrl() + getApiPrefix() + '/auth/logout', {
          method:  'POST',
          headers: {
            'Authorization':              'Bearer ' + token,
            'ngrok-skip-browser-warning': 'true',
          },
        });
      } catch { /* ignore network errors on logout */ }
    }
    clearSession();
    window.location.href = '/';
  }

  // Fix [1][2]: "teacher" → "lecturer" throughout
  function requireAuth(allowedRoles) {
    const user = getUser();

    if (!user || !getToken()) {
      clearSession();
      window.location.href = '/';
      return null;
    }

    if (allowedRoles && !allowedRoles.includes(user.role)) {
      // Fix [2]: route lecturer (not "teacher") to teacher dashboard
      if (user.role === 'student') {
        window.location.href = '/student.html';
      } else if (user.role === 'lecturer' || user.role === 'admin') {
        window.location.href = '/teacher.html';
      } else {
        clearSession();
        window.location.href = '/';
      }
      return null;
    }

    return user;
  }

  function decodeToken(token) {
    try {
      const b64    = token.split('.')[1];
      const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
      return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
    } catch {
      return null;
    }
  }

  function isTokenExpired(token) {
    const payload = decodeToken(token);
    if (!payload || !payload.exp) return false;
    return Date.now() / 1000 > payload.exp;
  }

  function checkExpiry() {
    const token = getToken();
    if (token && isTokenExpired(token)) logout();
  }

  // Fix [3]: build user object from JWT payload
  // Your Cell 6 generates: { user_id, username, role, jti, iat, exp }
  function buildUserFromToken(token) {
    const p = decodeToken(token);
    if (!p) return null;
    return {
      id:       p.user_id,   // Cell 6 uses "user_id" not "sub"
      username: p.username,
      role:     p.role,
    };
  }

  setInterval(checkExpiry, 5 * 60 * 1000);

  return {
    getToken,
    getUser,
    setSession,
    clearSession,
    logout,
    requireAuth,
    decodeToken,
    isTokenExpired,
    buildUserFromToken,
  };

})();

window.Auth = Auth;