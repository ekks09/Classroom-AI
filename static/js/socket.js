// ============================================================
// O.R.I.S. Socket.IO client wrapper
// ============================================================

'use strict';

/* global window, io, CONFIG, getApiBaseUrl, Auth */

const socketClient = (() => {

  let socket      = null;
  let connected   = false;
  let isRecording = false;
  let mediaStream = null;
  let audioCtx    = null;
  let processor   = null;

  const handlers = new Map();

  function emitLocal(evt, payload) {
    const set = handlers.get(evt);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); }
      catch (e) { console.error(`Handler error [${evt}]:`, e); }
    }
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    if (socket) socket.on(evt, fn);
  }

  function off(evt, fn) {
    handlers.get(evt)?.delete(fn);
    if (socket) socket.off(evt, fn);
  }

  function emit(evt, data) {
    if (!socket || !connected) {
      console.warn('Socket not connected — cannot emit', evt);
      return;
    }
    socket.emit(evt, data);
  }

  function connect(baseUrl, token) {
    const url = baseUrl || getApiBaseUrl?.();
    if (!url) throw new Error('Backend URL not configured');

    if (socket) {
      try { socket.disconnect(); } catch { }
      socket = null;
    }

    const socketUrl = url.startsWith('http') ? url : `https://${url}`;
    console.log('[Socket] Connecting to:', socketUrl);

    socket = io(socketUrl, {
      transports:           ['websocket', 'polling'],
      auth:                 { token },
      reconnection:         true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
      extraHeaders:         { 'ngrok-skip-browser-warning': 'true' },
    });

    // ── Core events ─────────────────────────────────────────

    socket.on('connect', () => {
      connected = true;
      console.log('[Socket] Connected');
      emitLocal('socket_connected', { url: socketUrl });
    });

    socket.on('disconnect', () => {
      connected = false;
      console.log('[Socket] Disconnected');
      emitLocal('socket_disconnected', {});
    });

    socket.on('connect_error', (err) => {
      connected = false;
      console.error('[Socket] Error:', err.message);
      emitLocal('socket_error', { error: err.message || String(err) });
    });

    // Fix [4]: transcript — backend emits {id, text, source, confidence}
    socket.on('transcript', (data) => {
      emitLocal('transcript', data);
    });

    // Fix [3]: student insight streaming chunks
    socket.on('insight:student:chunk', (data) => {
      emitLocal('insight:student:chunk', data);
    });
    socket.on('insight:student:done', (data) => {
      emitLocal('insight:student:done', data);
    });

    // Fix [3]: lecturer insight streaming chunks (teacher dashboard)
    socket.on('insight:lecturer:chunk', (data) => {
      emitLocal('insight:lecturer:chunk', data);
    });
    socket.on('insight:lecturer:done', (data) => {
      emitLocal('insight:lecturer:done', data);
    });

    // Fix [5]: chat streaming
    socket.on('chat_token', (data) => {
      emitLocal('chat_token', data);
    });
    socket.on('chat_response', (data) => {
      emitLocal('chat_response', data);
    });

    // Session state updates from live engine
    socket.on('session:state', (data) => {
      emitLocal('session:state', data);
    });

    // Re-bind any user handlers registered before connect()
    for (const [evt, set] of handlers.entries()) {
      for (const fn of set) socket.on(evt, fn);
    }
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
      connected = false;
    }
  }

  // Fix [1]: include user_id so Cell 8 live_engine.join_student() works
  function joinSession(session_id, user_id) {
    if (!socket) { console.warn('Socket not connected'); return; }
    socket.emit('join_session', { session_id, user_id });
  }

  function leaveSession(session_id, user_id) {
    if (!socket) return;
    socket.emit('leave_session', { session_id, user_id });
  }

  // ── Audio recording ───────────────────────────────────────

  async function startRecording(session_id) {
    if (!socket || !connected) throw new Error('Socket not connected');
    if (isRecording) return;
    if (!session_id) throw new Error('session_id required');

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx    = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });
    const source = audioCtx.createMediaStreamSource(mediaStream);
    processor    = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    isRecording = true;
    emitLocal('recording_start', { session_id });

    // Fix [2]: base64 audio for Socket.IO path — Cell 9 audio_chunk
    // handler accepts base64 string and decodes it
    processor.onaudioprocess = (e) => {
      if (!isRecording || !socket || !connected) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      socket.emit('audio_chunk', {
        session_id,
        audio: arrayBufferToBase64(pcm16.buffer),  // base64 — Cell 9 decodes
      });
    };
  }

  async function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    emitLocal('recording_stop', {});

    try { processor?.disconnect(); } catch { }
    processor = null;
    try { await audioCtx?.close(); } catch { }
    audioCtx = null;
    try { mediaStream?.getTracks()?.forEach(t => t.stop()); } catch { }
    mediaStream = null;
  }

  // ── Web Speech API recogniser ─────────────────────────────

  function createSpeechRecognizer(onTranscript, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('SpeechRecognition not supported in this browser');

    const rec        = new SR();
    rec.lang         = 'en-US';
    rec.interimResults = true;
    rec.continuous   = true;

    rec.onresult = (ev) => {
      let interim = '', final = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r   = ev.results[i];
        const txt = r[0]?.transcript || '';
        if (r.isFinal) final += txt;
        else interim += txt;
      }
      const combined = (final || interim || '').trim();
      if (combined) onTranscript?.(combined, !!final);
    };

    rec.onend   = () => onEnd?.();
    rec.onerror = () => onEnd?.();

    return rec;
  }

  // ── Send transcript text via socket (Web Speech path) ────

  function sendTranscriptText(session_id, text, is_final, confidence = 1.0) {
    if (!socket || !connected) return;
    socket.emit('transcript_text', {
      session_id,
      text,
      is_final,
      confidence,
    });
  }

  return {
    get socket()      { return socket; },
    get connected()   { return connected; },
    get isRecording() { return isRecording; },
    on,
    off,
    emit,
    connect,
    disconnect,
    joinSession,
    leaveSession,
    startRecording,
    stopRecording,
    createSpeechRecognizer,
    sendTranscriptText,
  };

})();

window.socketClient = socketClient;