// ============================================================
// O.R.I.S. Landing page logic (login/register)
// ============================================================

/* global window, document, api, Auth */

(function () {
  function $(id) { return document.getElementById(id); }

  function setActiveTab(which) {
    const loginTab = $('loginTab');
    const registerTab = $('registerTab');
    const loginForm = $('loginForm');
    const registerForm = $('registerForm');

    const isLogin = which === 'login';
    loginTab?.classList.toggle('active', isLogin);
    registerTab?.classList.toggle('active', !isLogin);
    loginForm?.classList.toggle('hidden', !isLogin);
    registerForm?.classList.toggle('hidden', isLogin);
  }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const username = ($('loginUser')?.value || '').trim();
    const password = $('loginPass')?.value || '';
    if (!username || !password) return;

    try {
      const res = await api.login(username, password);
      api.setToken(res?.access_token || '');
      Auth.setUser(res?.user || null);
      Auth.redirectToDashboard();
    } catch (err) {
      window.alert(err?.message || 'Login failed');
    }
  }

  async function onRegisterSubmit(e) {
    e.preventDefault();
    const username = ($('registerUser')?.value || '').trim();
    const email = ($('registerEmail')?.value || '').trim();
    const password = $('registerPass')?.value || '';
    if (!username || !email || !password) return;

    try {
      await api.register({
        username,
        email,
        password,
        role: 'student',
        learning_style: 'visual',
      });

      // Auto-login for smoother UX
      const res = await api.login(username, password);
      api.setToken(res?.access_token || '');
      Auth.setUser(res?.user || null);
      Auth.redirectToDashboard();
    } catch (err) {
      window.alert(err?.message || 'Registration failed');
    }
  }

  function wire() {
    $('loginTab')?.addEventListener('click', () => setActiveTab('login'));
    $('registerTab')?.addEventListener('click', () => setActiveTab('register'));
    $('loginForm')?.addEventListener('submit', onLoginSubmit);
    $('registerForm')?.addEventListener('submit', onRegisterSubmit);

    // If already logged in, jump straight to dashboard
    try {
      if (Auth.isLoggedIn()) Auth.redirectToDashboard();
    } catch {
      // ignore
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();

