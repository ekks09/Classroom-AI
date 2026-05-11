// ============================================================
// O.R.I.S. Auth helpers (JWT + localStorage)
// ============================================================

/* global window, localStorage, CONFIG, api */

const Auth = {
  isLoggedIn() {
    return !!api.getToken() && !!this.getUser();
  },

  setUser(user) {
    if (!user) {
      localStorage.removeItem(CONFIG.USER_KEY);
      return;
    }
    localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(user));
  },

  getUser() {
    try {
      const raw = localStorage.getItem(CONFIG.USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  initials() {
    const u = this.getUser();
    const name = (u?.username || u?.email || '').trim();
    if (!name) return '?';
    const parts = name.split(/[\s._-]+/).filter(Boolean);
    const a = (parts[0]?.[0] || '?').toUpperCase();
    const b = (parts[1]?.[0] || '').toUpperCase();
    return (a + b).slice(0, 2);
  },

  redirectToDashboard() {
    const u = this.getUser();
    if (!u) {
      window.location.href = '/';
      return;
    }
    if (u.role === 'teacher' || u.role === 'admin') window.location.href = '/teacher.html';
    else window.location.href = '/student.html';
  },

  logout() {
    api.clearToken();
    this.setUser(null);
    window.location.href = '/';
  },
};
