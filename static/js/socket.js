// ============================================================
// O.R.I.S. Socket.IO client wrapper + browser audio capture
// ============================================================

/* global window, io, CONFIG, getApiBaseUrl */

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
      try {
        fn(payload);
      } catch (e) {
        console.error(`Error in ${evt} handler:`, e);
      }
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
    // Use provided URL or fall back to config
    const url = baseUrl || getApiBaseUrl?.();

    if (!url) throw new Error('Backend URL not configured');

    if (socket) {
      try {
        socket.disconnect();
      } catch {}
      socket = null;
    }

    // Ensure HTTPS for Socket.IO
    const socketUrl = url.startsWith('http') ? url : `https://${url}`;

    console.log('Connecting to Socket.IO at:', socketUrl);

    socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
      extraHeaders: {
        'ngrok-skip-browser-warning': 'true',
      },
    });

    socket.on('connect', () => {
      connected = true;
      console.log('✅ Socket.IO connected:', socketUrl);
      emitLocal('socket_connected', { url: socketUrl });
    });

    socket.on('disconnect', () => {
      connected = false;
      console.log('❌ Socket.IO disconnected');
      emitLocal('socket_disconnected', {});
    });

    socket.on('connect_error', (error) => {
      connected = false;
      console.error('⚠️ Socket.IO connection error:', error);
      emitLocal('socket_error', { error: error.message || String(error) });
    });

    // re-bind user handlers
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

  function joinSession(session_id) {
    if (!socket) {
      console.warn('Socket not connected, cannot join session');
      return;
    }
    socket.emit('join_session', { session_id });
  }

  async function startRecording(session_id) {
    if (!socket) throw new Error('Socket not connected');
    if (isRecording) return;
    if (!session_id) throw new Error('session_id required');

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000,
      });
      const source = audioCtx.createMediaStreamSource(mediaStream);

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
        socket.emit('audio_chunk', {
          session_id,
          audio: arrayBufferToBase64(pcm16.buffer),
        });
      };
    } catch (e) {
      console.error('Error starting recording:', e);
      throw e;
    }
  }

  async function stopRecording() {
    if (!socket) return;
    if (!isRecording) return;

    isRecording = false;

    try {
      emitLocal('recording_stop', {});
    } catch {}

    try {
      processor?.disconnect();
    } catch {}
    processor = null;

    try {
      audioCtx?.close();
    } catch {}
    audioCtx = null;

    try {
      mediaStream?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    mediaStream = null;
  }

  function createSpeechRecognizer(onTranscript, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('SpeechRecognition not supported');

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
    get socket() {
      return socket;
    },
    get connected() {
      return connected;
    },
    get isRecording() {
      return isRecording;
    },
    on,
    off,
    connect,
    disconnect,
    joinSession,
    startRecording,
    stopRecording,
    createSpeechRecognizer,
  };
})();