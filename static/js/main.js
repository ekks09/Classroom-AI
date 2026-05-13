// ============================================================
// O.R.I.S. Landing page logic (login/register)
// ============================================================

/* global window, document, api, Auth */

(function () {
  try {
    window.Logger?.setContext({ page: 'index' });
  } catch {}

  function $(id) { return document.getElementById(id); }

  function setMsg(kind, text) {
    const el = $('authMsg');
    if (!el) return;
    el.classList.remove('hidden', 'ok', 'err');
    if (!text) {
      el.classList.add('hidden');
      el.textContent = '';
      return;
    }
    el.classList.add(kind === 'ok' ? 'ok' : 'err');
    el.textContent = text;
  }

  function setBusy(formId, busy) {
    const form = $(formId);
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = !!busy;
    const inputs = form.querySelectorAll('input, select, button');
    inputs.forEach((n) => { n.disabled = !!busy; });
  }

   function setActiveTab(which) {
     const loginTab = $('loginTab');
     const registerTab = $('registerTab');
     const loginCard = $('loginCard');
     const registerCard = $('registerCard');

     const isLogin = which === 'login';
     loginTab?.classList.toggle('active', isLogin);
     registerTab?.classList.toggle('active', !isLogin);
     loginCard?.classList.toggle('hidden', !isLogin);
     registerCard?.classList.toggle('hidden', isLogin);
     setMsg('ok', '');
     
     // Focus username field when showing form
     if (isLogin) {
       $('loginUser')?.focus();
     } else {
       $('registerUser')?.focus();
     }
   }

  async function onLoginSubmit(e) {
    e.preventDefault();
    const username = ($('loginUser')?.value || '').trim();
    const password = $('loginPass')?.value || '';
    if (!username || !password) return;

    try {
      setMsg('ok', '');
      setBusy('loginForm', true);
      const res = await api.login(username, password);
      api.setToken(res?.access_token || '');
      Auth.setUser(res?.user || null);
      Auth.redirectToDashboard();
    } catch (err) {
      setMsg('err', err?.message || 'Login failed');
    } finally {
      setBusy('loginForm', false);
    }
  }

  async function onRegisterSubmit(e) {
    e.preventDefault();
    const username = ($('registerUser')?.value || '').trim();
    const email = ($('registerEmail')?.value || '').trim();
    const password = $('registerPass')?.value || '';
    if (!username || !email || !password) return;

    try {
      setMsg('ok', '');
      setBusy('registerForm', true);
      const role = ($('registerRole')?.value || 'student').trim() || 'student';
      const learning_style = ($('registerStyle')?.value || 'visual').trim() || 'visual';
      await api.register({
        username,
        email,
        password,
        role,
        learning_style,
      });

      // Auto-login for smoother UX
      const res = await api.login(username, password);
      api.setToken(res?.access_token || '');
      Auth.setUser(res?.user || null);
      Auth.redirectToDashboard();
    } catch (err) {
      setMsg('err', err?.message || 'Registration failed');
    } finally {
      setBusy('registerForm', false);
    }
  }

   function wire() {
     $('loginTab')?.addEventListener('click', () => setActiveTab('login'));
     $('registerTab')?.addEventListener('click', () => setActiveTab('register'));
     $('loginForm')?.addEventListener('submit', onLoginSubmit);
     $('registerForm')?.addEventListener('submit', onRegisterSubmit);

     // Global keyboard shortcuts
     document.addEventListener('keydown', (e) => {
       if (e.key === 'Enter') {
         // Enter key will trigger form submission via the form's submit event
         // We don't need to do anything extra here
         return;
       }
       if (e.key === 'Escape') {
         e.preventDefault();
         setMsg('ok', '');
         // Try to focus the first input of the active form
         const activeForm = document.querySelector('.auth-form:not(.hidden)');
         if (activeForm) {
           const firstInput = activeForm.querySelector('input, select');
           if (firstInput) firstInput.focus();
         }
       }
     });

     // If already logged in, jump straight to dashboard
     try {
       if (Auth.isLoggedIn()) Auth.redirectToDashboard();
     } catch {
       // ignore
     }

     // allow direct linking: /?tab=register
     try {
       const url = new URL(window.location.href);
       const tab = (url.searchParams.get('tab') || '').toLowerCase();
       if (tab === 'register') setActiveTab('register');
       else setActiveTab('login');
     } catch {
       setActiveTab('login');
     }
   }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
