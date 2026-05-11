// ============================================================
// O.R.I.S. Frontend Logger (client-side)
// - Captures console + window errors + unhandled rejections
// - Persists recent logs to localStorage
// - Optional in-page overlay (Ctrl+Shift+L) when debug enabled
// ============================================================

/* global window, document, localStorage */

(function () {
  const LOG_KEY = 'oris_logs_v1';
  const DEBUG_KEY = 'oris_debug';
  const OUTBOX_KEY = 'oris_logs_outbox_v1';

  const MAX = 250;
  const buf = [];
  const outbox = [];
  let context = { page: '', user: null, role: null };

  function nowIso() {
    try { return new Date().toISOString(); } catch { return String(Date.now()); }
  }

  function safeJson(v) {
    try {
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      return v;
    } catch {
      return String(v);
    }
  }

  function push(entry) {
    buf.push(entry);
    if (buf.length > MAX) buf.splice(0, buf.length - MAX);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(buf)); } catch { /* ignore */ }
  }

  function outboxSave() {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox)); } catch { /* ignore */ }
  }

  function outboxLoad() {
    try {
      const raw = localStorage.getItem(OUTBOX_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) outbox.splice(0, outbox.length, ...arr.slice(-MAX));
    } catch {
      // ignore
    }
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(LOG_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        buf.splice(0, buf.length, ...arr.slice(-MAX));
      }
    } catch {
      // ignore
    }
  }

  function isDebugEnabled() {
    try {
      const u = new URL(window.location.href);
      const q = (u.searchParams.get('debug') || '').trim();
      if (q === '1' || q.toLowerCase() === 'true') {
        localStorage.setItem(DEBUG_KEY, '1');
        u.searchParams.delete('debug');
        window.history.replaceState({}, '', u.toString());
        return true;
      }
    } catch {
      // ignore
    }
    return (localStorage.getItem(DEBUG_KEY) || '') === '1';
  }

  function setDebug(enabled) {
    try { localStorage.setItem(DEBUG_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
  }

  function log(level, message, meta) {
    const entry = {
      ts: nowIso(),
      level,
      msg: String(message ?? ''),
      meta: meta ? safeJson(meta) : undefined,
      ctx: context,
    };
    push(entry);
    // Ship only warnings/errors unless debug is enabled
    const shouldShip = isDebugEnabled() || level === 'error' || level === 'warn';
    if (shouldShip) {
      outbox.push(entry);
      if (outbox.length > MAX) outbox.splice(0, outbox.length - MAX);
      outboxSave();
      flushOutboxSoon();
    }
    return entry;
  }

  function patchConsole() {
    const orig = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };

    ['log', 'info', 'warn', 'error', 'debug'].forEach((k) => {
      if (typeof orig[k] !== 'function') return;
      console[k] = function (...args) {
        try {
          const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(safeJson(a)))).join(' ');
          log(k === 'log' ? 'info' : k, msg);
        } catch {
          // ignore
        }
        return orig[k].apply(console, args);
      };
    });
  }

  function attachGlobalHandlers() {
    window.addEventListener('error', (e) => {
      log('error', 'window.error', {
        message: e?.message,
        filename: e?.filename,
        lineno: e?.lineno,
        colno: e?.colno,
        error: safeJson(e?.error),
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      log('error', 'unhandledrejection', {
        reason: safeJson(e?.reason),
      });
    });
  }

  let _flushTimer = null;
  function flushOutboxSoon() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      flushOutbox();
    }, 600);
  }

  async function flushOutbox() {
    if (!outbox.length) return;
    // Needs backend helpers from config.js (loaded after logger.js)
    const getBase = window.getApiBaseUrl;
    const getPref = window.getApiPrefix;
    if (typeof getBase !== 'function' || typeof getPref !== 'function') return;

    let url;
    try {
      url = getBase() + getPref() + '/client-logs';
    } catch {
      return;
    }

    const batch = outbox.slice(0, 25);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        keepalive: true,
      });
      if (!resp.ok) return;
      outbox.splice(0, batch.length);
      outboxSave();
    } catch {
      // keep outbox for later
    }
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderOverlay() {
    if (document.getElementById('orisLogOverlay')) return;

    const style = document.createElement('style');
    style.textContent = `
      #orisLogBtn{position:fixed;right:14px;bottom:14px;z-index:9999;padding:10px 12px;border-radius:999px;
        border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.38);color:rgba(255,255,255,.85);
        font:12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;
        backdrop-filter: blur(10px);cursor:pointer}
      #orisLogOverlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.52);backdrop-filter: blur(6px);display:none}
      #orisLogPanel{position:absolute;right:14px;bottom:60px;width:min(820px, calc(100vw - 28px));height:min(70vh, 520px);
        border-radius:16px;border:1px solid rgba(255,255,255,.18);background:rgba(8,10,16,.86);box-shadow:0 20px 60px rgba(0,0,0,.55);
        display:flex;flex-direction:column;overflow:hidden}
      #orisLogHdr{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.10)}
      #orisLogHdr .t{color:rgba(255,255,255,.9);font:12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;letter-spacing:.08em;text-transform:uppercase}
      #orisLogHdr .a{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      #orisLogHdr button, #orisLogHdr input{border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.35);color:rgba(255,255,255,.85);
        font:12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono","Courier New", monospace;padding:8px 10px}
      #orisLogHdr button{cursor:pointer}
      #orisLogHdr button:hover{border-color:rgba(0,240,255,.35)}
      #orisLogList{flex:1;overflow:auto;padding:10px 12px}
      .olis{display:flex;gap:10px;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,.08)}
      .olis .lvl{width:56px;text-transform:uppercase;font-size:11px;opacity:.85}
      .olis .ts{width:170px;font-size:11px;color:rgba(255,255,255,.55)}
      .olis .msg{flex:1;font-size:12px;color:rgba(255,255,255,.88);white-space:pre-wrap;word-break:break-word}
      .lvl-error{color:#ff5b6e}.lvl-warn{color:#ffd24f}.lvl-info{color:#7cf3ff}.lvl-debug{color:#c7b6ff}
    `;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'orisLogBtn';
    btn.type = 'button';
    btn.textContent = 'Logs';

    const ov = document.createElement('div');
    ov.id = 'orisLogOverlay';

    const panel = document.createElement('div');
    panel.id = 'orisLogPanel';

    const hdr = document.createElement('div');
    hdr.id = 'orisLogHdr';
    hdr.innerHTML = `
      <div class="t">ORIS Logs</div>
      <div class="a">
        <input id="orisLogFilter" placeholder="filter…" style="width:180px"/>
        <button id="orisLogExport" type="button">Export</button>
        <button id="orisLogClear" type="button">Clear</button>
        <button id="orisLogClose" type="button">Close</button>
      </div>
    `;

    const list = document.createElement('div');
    list.id = 'orisLogList';

    panel.appendChild(hdr);
    panel.appendChild(list);
    ov.appendChild(panel);
    document.body.appendChild(btn);
    document.body.appendChild(ov);

    function render() {
      const q = (document.getElementById('orisLogFilter')?.value || '').toLowerCase();
      const items = buf.slice(-MAX).filter((e) => {
        if (!q) return true;
        return (e.msg || '').toLowerCase().includes(q) || JSON.stringify(e.meta || {}).toLowerCase().includes(q);
      });

      list.innerHTML = items.map((e) => {
        const lvl = (e.level || 'info').toLowerCase();
        const cls = lvl === 'error' ? 'lvl-error' : lvl === 'warn' ? 'lvl-warn' : lvl === 'debug' ? 'lvl-debug' : 'lvl-info';
        return `
          <div class="olis">
            <div class="lvl ${cls}">${lvl}</div>
            <div class="ts">${e.ts || ''}</div>
            <div class="msg">${escapeHtml(e.msg || '')}${e.meta ? `\n${escapeHtml(JSON.stringify(e.meta))}` : ''}</div>
          </div>
        `;
      }).join('') || `<div style="color:rgba(255,255,255,.65);font:12px var(--fm, ui-monospace)">No logs yet.</div>`;

      list.scrollTop = list.scrollHeight;
    }

    function open() { ov.style.display = 'block'; render(); }
    function close() { ov.style.display = 'none'; }

    function escapeHtml(s) {
      const d = document.createElement('div');
      d.textContent = String(s ?? '');
      return d.innerHTML;
    }

    btn.addEventListener('click', open);
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.getElementById('orisLogClose')?.addEventListener('click', close);
    document.getElementById('orisLogFilter')?.addEventListener('input', render);

    document.getElementById('orisLogClear')?.addEventListener('click', () => {
      buf.splice(0, buf.length);
      try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ }
      render();
    });

    document.getElementById('orisLogExport')?.addEventListener('click', () => {
      download(`oris-logs-${Date.now()}.json`, JSON.stringify(buf, null, 2));
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && ov.style.display === 'block') close();
      if (e.key.toLowerCase() === 'l' && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        if (ov.style.display === 'block') close(); else open();
      }
    });
  }

  // Public API
  const Logger = {
    log,
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta),
    debug: (m, meta) => log('debug', m, meta),
    setContext: (ctx) => { context = { ...context, ...(ctx || {}) }; },
    getLogs: () => buf.slice(),
    clear: () => { buf.splice(0, buf.length); try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ } },
    isDebugEnabled,
    setDebug,
    flush: flushOutbox,
  };

  window.Logger = Logger;

  loadSaved();
  outboxLoad();
  patchConsole();
  attachGlobalHandlers();

  if (isDebugEnabled()) {
    renderOverlay();
    log('info', 'debug enabled');
  }

  // Best-effort flush when leaving the page
  try {
    window.addEventListener('beforeunload', () => { flushOutbox(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushOutbox();
    });
  } catch {
    // ignore
  }
})();
