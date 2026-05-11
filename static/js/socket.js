// ============================================================
// O.R.I.S. Socket.IO client wrapper + browser audio capture
// ============================================================

/* global window, io */

const socketClient = (() => {
  let socket = null;
  let connected = false;
  let isRecording = false;
  let mediaStream = null;
  let audioCtx = null;
  let processor = null;
  const handlers = new Map();

  function emitLocal(evt, payload) {
    const set = handlers.get(evt);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch {}
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

  function connect(baseUrl, token) {
    if (!baseUrl) throw new Error('Backend URL not configured');
    if (socket) {
      try { socket.disconnect(); } catch {}
      socket = null;
    }

    socket = io(baseUrl, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => { connected = true; });
    socket.on('disconnect', () => { connected = false; });
    socket.on('connect_error', () => { connected = false; });

    // re-bind user handlers
    for (const [evt, set] of handlers.entries()) {
      for (const fn of set) socket.on(evt, fn);
    }
  }

  function joinSession(session_id) {
    if (!socket) return;
    socket.emit('join_session', { session_id });
  }

  async function startRecording(session_id) {
    if (!socket) throw new Error('Socket not connected');
    if (isRecording) return;
    if (!session_id) throw new Error('session_id required');

    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    const source = audioCtx.createMediaStreamSource(mediaStream);

    // ScriptProcessorNode is deprecated but widely supported and simple for vanilla JS.
    processor = audioCtx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    emitLocal('recording_start', { session_id });
    isRecording = true;

    processor.onaudioprocess = (e) => {
      if (!isRecording || !socket) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      socket.emit('audio_chunk', { session_id, audio: arrayBufferToBase64(pcm16.buffer) });
    };
  }

  async function stopRecording() {
    if (!socket) return;
    if (!isRecording) return;
    isRecording = false;

    try { emitLocal('recording_stop', {}); } catch {}

    try { processor?.disconnect(); } catch {}
    processor = null;

    try { audioCtx?.close(); } catch {}
    audioCtx = null;

    try {
      mediaStream?.getTracks()?.forEach(t => t.stop());
    } catch {}
    mediaStream = null;
  }

  function createSpeechRecognizer(onTranscript, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('SpeechRecognition not supported in this browser');
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (ev) => {
      let interim = '';
      let finalText = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const txt = res[0]?.transcript || '';
        if (res.isFinal) finalText += txt;
        else interim += txt;
      }
      const combined = (finalText || interim || '').trim();
      if (combined) onTranscript?.(combined, !!finalText);
    };
    rec.onend = () => onEnd?.();
    rec.onerror = () => onEnd?.();

    return rec;
  }

  return {
    get socket() { return socket; },
    get connected() { return connected; },
    get isRecording() { return isRecording; },
    on,
    off,
    connect,
    joinSession,
    startRecording,
    stopRecording,
    createSpeechRecognizer,
  };
})();
