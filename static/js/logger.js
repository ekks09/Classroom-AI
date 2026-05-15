/* ============================================================
   js/logger.js — Client-side logger with backend shipping
   ============================================================ */

'use strict';

const Logger = (() => {

  const KEY      = 'oris_logs_v1';
  const MAX_LOGS = 500;
  const VERSION  = '3.0';

  let _debugMode  = false;
  let _panel      = null;
  let _shipTimer  = null;
  let _buffer     = [];

  // ── INIT ──────────────────────────────────────────────────

  function init() {
    // Check ?debug=1 or Ctrl+Shift+L
    try {
      const u = new URL(window.location.href);
      if (u.searchParams.get('debug') === '1') {
        _debugMode = true;
        localStorage.setItem('oris_debug', '1');
        u.searchParams.delete('debug');
        window.history.replaceState({}, '', u.toString());
      } else {
        _debugMode = localStorage.getItem('oris_debug') === '1';
      }
    } catch {
      _debugMode = false;
    }

    if (_debugMode) createPanel();

    // Keyboard toggle
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        toggle();
      }
    });

    // Ship errors/warnings always
    window.addEventListener('error', (e) => {
      error('window.error', e.message, {
        file: e.filename,
        line: e.lineno,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      error('unhandledrejection', String(e.reason));
    });

    // Start shipping timer (every 30s)
    _shipTimer = setInterval(shipLogs, 30000);
  }

  // ── LOG LEVELS ────────────────────────────────────────────

  function log(level, category, message, data) {
    const entry = {
      v:   VERSION,
      ts:  Date.now(),
      lvl: level,
      cat: category,
      msg: message,
      dat: data || null,
      url: window.location.pathname,
    };

    // Console
    const fn = {
      debug: console.debug,
      info:  console.info,
      warn:  console.warn,
      error: console.error,
    }[level] || console.log;

    fn(`[ORIS:${category}]`, message, data || '');

    // Store
    _buffer.push(entry);
    persist(entry);

    // Panel
    if (_debugMode && _panel) appendToPanel(entry);

    // Ship errors immediately
    if (level === 'error' || level === 'warn') {
      shipLogs();
    }
  }

  function debug(cat, msg, data) { log('debug', cat, msg, data); }
  function info(cat, msg, data)  { log('info',  cat, msg, data); }
  function warn(cat, msg, data)  { log('warn',  cat, msg, data); }
  function error(cat, msg, data) { log('error', cat, msg, data); }

  // ── PERSIST ───────────────────────────────────────────────

  function persist(entry) {
    try {
      const raw    = localStorage.getItem(KEY);
      const stored = raw ? JSON.parse(raw) : [];
      stored.push(entry);

      // Trim to MAX_LOGS
      if (stored.length > MAX_LOGS) {
        stored.splice(0, stored.length - MAX_LOGS);
      }

      localStorage.setItem(KEY, JSON.stringify(stored));
    } catch {}
  }

  function getAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function clear() {
    localStorage.removeItem(KEY);
    _buffer = [];
    if (_panel) {
      const body = _panel.querySelector('.log-body');
      if (body) body.innerHTML = '';
    }
  }

  // ── SHIP TO BACKEND ───────────────────────────────────────

  async function shipLogs() {
    if (!_buffer.length) return;

    const toShip = _buffer.splice(0);

    try {
      const base = (typeof getApiBaseUrl === 'function')
        ? getApiBaseUrl()
        : '';

      if (!base) return;

      await fetch(base + '/api/client-logs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type: 'client_log',
          logs: toShip,
          ua:   navigator.userAgent,
          page: window.location.href,
        }),
        keepalive: true,
      });
    } catch {
      // Silent — don't recurse
    }
  }

  // ── EXPORT ────────────────────────────────────────────────

  function exportLogs() {
    const all  = getAll();
    const blob = new Blob(
      [JSON.stringify(all, null, 2)],
      { type: 'application/json' }
    );
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `oris-logs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── DEBUG PANEL ───────────────────────────────────────────

  function createPanel() {
    if (_panel) return;

    _panel = document.createElement('div');
    _panel.id = 'oris-log-panel';
    _panel.innerHTML = `
      <div class="log-header">
        <span style="font-family:var(--fd);font-size:.65rem;
                     color:var(--cyan);letter-spacing:.1em">
          ORIS DEBUG LOG
        </span>
        <div style="display:flex;gap:.5rem">
          <button onclick="Logger.exportLogs()"
                  style="font-size:.58rem;color:var(--cyan);
                         background:none;border:none;cursor:pointer">
            EXPORT
          </button>
          <button onclick="Logger.clear()"
                  style="font-size:.58rem;color:var(--yellow);
                         background:none;border:none;cursor:pointer">
            CLEAR
          </button>
          <button onclick="Logger.toggle()"
                  style="font-size:.58rem;color:var(--red);
                         background:none;border:none;cursor:pointer">
            ✕
          </button>
        </div>
      </div>
      <div class="log-body" id="logBody"></div>
    `;

    Object.assign(_panel.style, {
      position:    'fixed',
      bottom:      '28px',
      right:       '0',
      width:       '420px',
      maxHeight:   '280px',
      background:  'rgba(2,2,2,0.96)',
      border:      '1px solid rgba(0,217,255,0.2)',
      borderRight: 'none',
      borderBottom:'none',
      zIndex:      '99999',
      fontSize:    '0.65rem',
      fontFamily:  'var(--fm,monospace)',
      display:     'flex',
      flexDirection:'column',
    });

    const header = _panel.querySelector('.log-header');
    Object.assign(header.style, {
      padding:      '0.4rem 0.75rem',
      borderBottom: '1px solid rgba(0,217,255,0.1)',
      display:      'flex',
      justifyContent:'space-between',
      alignItems:   'center',
      flexShrink:   '0',
    });

    const body = _panel.querySelector('.log-body');
    Object.assign(body.style, {
      overflow:  'auto',
      flex:      '1',
      padding:   '0.35rem 0.75rem',
    });

    document.body.appendChild(_panel);
  }

  function appendToPanel(entry) {
    const body = document.getElementById('logBody');
    if (!body) return;

    const color = {
      debug: 'var(--text3)',
      info:  'var(--text2)',
      warn:  'var(--yellow)',
      error: 'var(--red)',
    }[entry.lvl] || 'var(--text)';

    const line = document.createElement('div');
    line.style.cssText = `color:${color};padding:1px 0;
                          border-bottom:1px solid rgba(255,255,255,0.03)`;
    line.textContent =
      `${new Date(entry.ts).toLocaleTimeString()} `
      + `[${entry.lvl.toUpperCase()}] `
      + `${entry.cat}: ${entry.msg}`;

    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
  }

  function toggle() {
    _debugMode = !_debugMode;
    localStorage.setItem('oris_debug', _debugMode ? '1' : '0');

    if (_debugMode) {
      createPanel();
      if (_panel) _panel.style.display = 'flex';
    } else {
      if (_panel) _panel.style.display = 'none';
    }
  }

  // ── AUTO INIT ─────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    debug, info, warn, error,
    getAll, clear, exportLogs, toggle,
    get debugMode() { return _debugMode; },
  };

})();

window.Logger = Logger;