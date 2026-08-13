// NICKII AI, server.
// HTTPS + WSS + signaling + voice ingest + whisper bridge.
// Section 6 of NICKIIAI.md.
//
// The signaling protocol from the working version is preserved exactly:
// register-viewer, register-controller, cached webrtc-offer and ICE replay for
// late joining viewers, request-offer, webrtc-answer, webrtc-ice-candidate
// routing by target, viewer-count, prompt relay, and return-feed-* routing.
// The controller's offer now carries her live video (OBS Virtual Camera) and
// her live voice (BlackHole); only the SDP content changed, not the protocol.
// The return-feed-* types carry the continuous monitor feed from the iPad.
//
// There is no TTS and no synthesized audio in this system. The only voice is
// Nickii's, live, on the outgoing WebRTC track. This process never sees it.
//
// Binary frames exist in one direction only:
//   viewer -> server : Int16 PCM 16 kHz mono chunk, only inside a PTT session
//
// Neither the monitor feed nor the outgoing A/V passes through here, and
// nothing records either one.

const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const config = require('./config');

const IS_LOCAL = config.mode === 'local';
const SAMPLE_RATE = 16000;
const BYTES_PER_SAMPLE = 2;
const MAX_PCM_BYTES = config.maxUtteranceSeconds * SAMPLE_RATE * BYTES_PER_SAMPLE;

// ---------------------------------------------------------------- logging
// One line per event. Transcripts are logged. Neither the monitor feed nor the
// outgoing A/V is recorded anywhere, in any form.

const LOG_DIR = path.resolve(__dirname, config.logDir);
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}

function logFilePath() {
  const d = new Date();
  const stamp = d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
  return path.join(LOG_DIR, `nickii-${stamp}.log`);
}

function log(event, fields) {
  const parts = [new Date().toISOString(), event];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      const s = String(v).replace(/\s+/g, ' ').slice(0, 400);
      parts.push(`${k}=${JSON.stringify(s)}`);
    }
  }
  const line = parts.join(' ');
  console.log(line);
  fs.appendFile(logFilePath(), line + '\n', () => {});
}

// ---------------------------------------------------------------- app
const app = express();

app.get('/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(health());
});

// Client relevant config, so the browser files never hard code timings.
app.get('/config.json', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    mode: config.mode,
    sampleRate: SAMPLE_RATE,
    maxUtteranceSeconds: config.maxUtteranceSeconds,
    heartbeatClientMs: config.heartbeatClientMs,
    reconnect: config.reconnect,
    watchdogNoFeedMs: config.watchdogNoFeedMs,
    watchdogReloadMs: config.watchdogReloadMs,
    preferredDevices: config.preferredDevices,
    capture: config.capture,
    render: config.render,
    // No STUN and no TURN in local mode: same subnet, host candidates only.
    iceServers: IS_LOCAL ? [] : [{ urls: 'stun:stun.l.google.com:19302' }],
  });
});

// Operator panel log tail (Cmd+. on the controller). Private network only.
app.get('/logs/tail', (req, res) => {
  const n = Math.min(parseInt(req.query.n, 10) || 80, 500);
  fs.readFile(logFilePath(), 'utf8', (err, data) => {
    res.set('Cache-Control', 'no-store');
    if (err) return res.type('text/plain').send('');
    res.type('text/plain').send(data.trim().split('\n').slice(-n).join('\n'));
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'client.html')));
app.get('/control', (req, res) => res.sendFile(path.join(__dirname, 'public', 'control.html')));

// ---------------------------------------------------------------- server
// Local mode serves HTTPS with the mkcert certificate: getUserMedia only works
// in a secure context, and http://192.168.x.x is not one. Render mode runs
// plain HTTP behind the platform's own TLS.

let server;
let scheme = 'http';
const certFile = path.resolve(__dirname, config.certPath);
const keyFile = path.resolve(__dirname, config.keyPath);

if (IS_LOCAL && fs.existsSync(certFile) && fs.existsSync(keyFile)) {
  server = https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, app);
  scheme = 'https';
} else {
  if (IS_LOCAL) {
    console.warn('');
    console.warn('  No certificate found at ' + certFile);
    console.warn('  Falling back to plain HTTP. The iPad microphone will NOT work over http.');
    console.warn('  Run scripts/setup-https.sh on the Mac before the exhibition.');
    console.warn('');
  }
  server = http.createServer(app);
}

const PORT = IS_LOCAL ? config.httpsPort : (process.env.PORT || 3000);
const wss = new WebSocket.Server({ server, maxPayload: MAX_PCM_BYTES + 1024 });

// ---------------------------------------------------------------- state
const clients = {
  viewers: new Set(),
  controller: null,
};

// Cache the last offer plus ICE candidates from the controller so any viewer
// that joins late gets them immediately on registration. This is what makes an
// iPad reload bring her face back in well under three seconds.
let cachedOffer = null;
let cachedIceCandidates = [];

const state = {
  startedAt: Date.now(),
  monitorUp: false,
  feed: { video: false, audio: false },
  viewer: null,                     // last self report from the iPad
  lastTranscriptAt: null,
  transcriptCount: 0,
  whisperReachable: false,
  whisperCheckedAt: null,
};

function sendToController(data) {
  if (clients.controller && clients.controller.readyState === WebSocket.OPEN) {
    clients.controller.send(JSON.stringify(data));
  }
}

function broadcastToViewers(data) {
  const payload = JSON.stringify(data);
  clients.viewers.forEach((viewer) => {
    if (viewer.readyState === WebSocket.OPEN) viewer.send(payload);
  });
}

function sendJson(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function health() {
  return {
    ok: true,
    mode: config.mode,
    scheme,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
    controllerConnected: !!(clients.controller && clients.controller.readyState === WebSocket.OPEN),
    viewerCount: clients.viewers.size,
    whisperReachable: state.whisperReachable,
    whisperCheckedAt: state.whisperCheckedAt,
    monitorFeedUp: state.monitorUp,
    outgoingFeed: { video: state.feed.video, audio: state.feed.audio },
    viewer: state.viewer && (Date.now() - state.viewer.at < 15000) ? state.viewer : null,
    lastTranscriptAgeMs: state.lastTranscriptAt ? Date.now() - state.lastTranscriptAt : null,
    transcriptCount: state.transcriptCount,
    offerCached: !!cachedOffer,
  };
}

// ---------------------------------------------------------------- WAV
// 44 byte canonical WAV header, written by hand. No dependency.

function pcmToWav(pcm) {
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8);
  h.write('fmt ', 12);
  h.writeUInt32LE(16, 16);                       // PCM chunk size
  h.writeUInt16LE(1, 20);                        // format 1 = PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * blockAlign, 28); // byte rate
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------------------------------------------------------------- whisper
// whisper.cpp in server mode, model stays loaded. Whisper only ever sees PTT
// gated audio, never the continuous monitor stream.

function postToWhisper(wav, lang) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(config.whisperUrl); } catch (e) { return reject(new Error('bad whisperUrl')); }

    const boundary = '----nickii' + crypto.randomBytes(12).toString('hex');
    const field = (name, value) => Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    );

    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="utterance.wav"\r\nContent-Type: audio/wav\r\n\r\n`),
      wav,
      Buffer.from('\r\n'),
      field('temperature', '0.0'),
      field('response_format', 'verbose_json'),
      field('language', lang || config.whisperLang),
      Buffer.from(`--${boundary}--\r\n`),
    ]);

    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) return reject(new Error(`whisper ${res.statusCode}`));
        let text = '';
        let language = null;
        try {
          const json = JSON.parse(raw);
          if (typeof json.text === 'string') text = json.text;
          else if (Array.isArray(json.segments)) text = json.segments.map((s) => s.text || '').join(' ');
          if (typeof json.language === 'string') language = json.language;
        } catch (_) {
          text = raw;               // some builds answer with plain text
        }
        resolve({ text: text.trim(), language });
      });
    });

    req.setTimeout(config.whisperTimeoutMs, () => req.destroy(new Error('whisper timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

function probeWhisper(done) {
  let url;
  try { url = new URL(config.whisperUrl); } catch (_) { return done && done(); }
  let settled = false;
  const finish = (reachable) => {
    if (settled) return;
    settled = true;
    state.whisperReachable = reachable;
    state.whisperCheckedAt = Date.now();
    if (done) done();
  };
  const transport = url.protocol === 'https:' ? https : http;
  const req = transport.request({
    hostname: url.hostname,
    port: url.port || 80,
    path: '/',
    method: 'GET',
    timeout: 1500,
  }, (res) => {
    res.resume();
    finish(res.statusCode < 500);
  });
  req.on('error', () => finish(false));
  req.on('timeout', () => req.destroy());
  req.end();
}

// Poll hard while it is down, so /health goes green within seconds of whisper
// coming up during the show runbook, then back off once it is answering.
function scheduleProbe() {
  probeWhisper(() => {
    setTimeout(scheduleProbe, state.whisperReachable ? 15000 : 2000).unref();
  });
}
scheduleProbe();

// ---------------------------------------------------------------- junk filter
// Whisper hallucinates confidently on near silence. PTT gating removes most of
// it; this removes the rest.

function isJunk(text) {
  const t = text.trim();
  if (t.length < config.minTranscriptChars) return true;
  const bare = t.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!/[a-zA-ZÀ-ɏ0-9]/.test(bare)) return true;             // punctuation only
  if (config.junkTranscripts.some((j) => bare === j || bare === j.replace(/[.!?]$/, ''))) return true;
  if (/^[[(].*[\])]$/.test(bare)) return true;               // "[music]", "(silence)"
  return false;
}

// whisper.cpp reports the language by name ("german"), not as an ISO code, so
// it has to be mapped rather than truncated. Anything outside this list falls
// back to the orthographic guess. Visitors here are international, so it is
// worth Nickii seeing "IT" on screen rather than a wrong "EN".
const LANG_NAMES = {
  english: 'en', german: 'de', french: 'fr', spanish: 'es', italian: 'it',
  dutch: 'nl', portuguese: 'pt', polish: 'pl', czech: 'cs', slovak: 'sk',
  russian: 'ru', ukrainian: 'uk', turkish: 'tr', greek: 'el', hungarian: 'hu',
  romanian: 'ro', croatian: 'hr', slovenian: 'sl', serbian: 'sr',
  swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi',
  chinese: 'zh', japanese: 'ja', korean: 'ko', arabic: 'ar', hebrew: 'he',
};

function normalizeLang(raw, text) {
  if (!raw) return guessLang(text);
  const l = String(raw).trim().toLowerCase();
  if (LANG_NAMES[l]) return LANG_NAMES[l];
  // Already an ISO code, and one we recognise as a real answer.
  if (l.length === 2 && Object.values(LANG_NAMES).indexOf(l) !== -1) return l;
  return guessLang(text);
}

// When whisper gives nothing usable, a cheap orthographic guess still tells
// the controller whether the visitor spoke German or English.
function guessLang(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  if (/[äöüß]/.test(t)) return 'de';
  const de = [' der ', ' die ', ' das ', ' und ', ' ist ', ' ich ', ' nicht ', ' du ', ' wie ', ' was ', ' mit ', ' ein ', ' eine ', ' bist ', ' kannst ', ' wir ', ' sie '];
  const en = [' the ', ' and ', ' is ', ' you ', ' are ', ' what ', ' how ', ' can ', ' do ', ' i ', ' a ', ' to ', ' me ', ' your '];
  const score = (list) => list.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
  return score(de) > score(en) ? 'de' : 'en';
}

// ---------------------------------------------------------------- PTT sessions
function resetPtt(ws) {
  ws.ptt = { active: false, chunks: [], bytes: 0, lang: config.whisperLang, startedAt: null, truncated: false };
}

async function finishPtt(ws) {
  const s = ws.ptt;
  if (!s || !s.active) return;
  s.active = false;

  const pcm = Buffer.concat(s.chunks, s.bytes);
  const heldMs = s.startedAt ? Date.now() - s.startedAt : 0;
  const lang = s.lang;
  resetPtt(ws);

  const seconds = pcm.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
  if (seconds < 0.25) {
    log('ptt.too-short', { seconds: seconds.toFixed(2), heldMs });
    sendJson(ws, { type: 'transcript', text: '', final: true, error: true });
    return;
  }

  let result;
  try {
    result = await postToWhisper(pcmToWav(pcm), lang);
  } catch (err) {
    log('whisper.error', { error: err.message, seconds: seconds.toFixed(2) });
    state.whisperReachable = false;
    sendJson(ws, { type: 'transcript', text: '', final: true, error: true });
    return;
  }
  state.whisperReachable = true;   // a real transcription is the best probe there is

  const text = (result.text || '').trim();
  if (!text || isJunk(text)) {
    log('transcript.dropped', { seconds: seconds.toFixed(2), text });
    sendJson(ws, { type: 'transcript', text: '', final: true, error: true });
    return;
  }

  const detected = normalizeLang(result.language, text);
  const timestamp = Date.now();
  state.lastTranscriptAt = timestamp;
  state.transcriptCount += 1;

  log('transcript', { seconds: seconds.toFixed(2), lang: detected, text });

  sendJson(ws, { type: 'transcript', text, final: true, lang: detected });
  sendToController({ type: 'prompt', text, source: 'voice', lang: detected, timestamp });
}

// ---------------------------------------------------------------- connections
wss.on('connection', (ws, req) => {
  ws.role = null;
  ws.isAlive = true;
  ws.missedPongs = 0;
  resetPtt(ws);
  log('ws.connect', { ip: (req.socket.remoteAddress || '').replace(/^::ffff:/, '') });

  ws.on('pong', () => { ws.isAlive = true; ws.missedPongs = 0; });

  ws.on('message', (message, isBinary) => {
    // Binary from a viewer is always PCM for the open PTT session.
    if (isBinary) {
      if (ws.role !== 'viewer' || !ws.ptt.active) return;
      const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
      if (ws.ptt.bytes + buf.length > MAX_PCM_BYTES) {
        if (!ws.ptt.truncated) {
          ws.ptt.truncated = true;
          log('ptt.capped', { seconds: config.maxUtteranceSeconds });
        }
        return;
      }
      ws.ptt.chunks.push(buf);
      ws.ptt.bytes += buf.length;
      return;
    }

    let data;
    try { data = JSON.parse(message.toString()); } catch (err) { return; }
    if (!data || typeof data.type !== 'string') return;

    switch (data.type) {

      // -------------------------------------------------- preserved signaling
      case 'register-viewer':
        ws.role = 'viewer';
        clients.viewers.add(ws);
        log('viewer.register', { total: clients.viewers.size });
        sendToController({ type: 'viewer-count', count: clients.viewers.size });

        // A cached offer means the viewer does not wait for the controller.
        if (cachedOffer) {
          sendJson(ws, { type: 'webrtc-offer', offer: cachedOffer });
          cachedIceCandidates.forEach((candidate) => {
            sendJson(ws, { type: 'webrtc-ice-candidate', candidate });
          });
        } else {
          sendToController({ type: 'request-offer' });
        }
        break;

      case 'register-controller':
        ws.role = 'controller';
        clients.controller = ws;
        cachedOffer = null;
        cachedIceCandidates = [];
        state.monitorUp = false;
        state.feed = { video: false, audio: false };
        log('controller.register', {});
        sendToController({ type: 'viewer-count', count: clients.viewers.size });
        break;

      case 'webrtc-offer':
        cachedOffer = data.offer;
        cachedIceCandidates = [];
        log('offer.cached', { viewers: clients.viewers.size });
        broadcastToViewers(data);
        break;

      case 'webrtc-ice-candidate':
        if (data.target === 'viewer') {
          // Bounded on purpose. The cache is cleared on every new offer, so
          // this only ever fills if a controller streams candidates without
          // renegotiating. In a six hour unattended run, "in practice" is not
          // a good enough reason to leave a list unbounded.
          if (data.candidate && cachedIceCandidates.length < 128) {
            cachedIceCandidates.push(data.candidate);
          }
          broadcastToViewers(data);
        } else if (data.target === 'controller') {
          sendToController(data);
        }
        break;

      case 'webrtc-answer':
        sendToController(data);
        break;

      case 'prompt': {
        const text = (data.text || '').trim();
        if (!text) break;
        log('prompt', { source: data.source || 'typed', text });
        sendToController({ type: 'prompt', text, source: data.source || 'typed', timestamp: Date.now() });
        break;
      }

      // Monitor feed signaling. Routing semantics unchanged.
      case 'return-feed-offer':
      case 'return-feed-answer':
      case 'return-feed-ice':
        if (data.target === 'controller') sendToController(data);
        else broadcastToViewers(data);
        break;

      // -------------------------------------------------- added
      case 'hb':
        sendJson(ws, { type: 'hb-ack', t: Date.now() });
        break;

      case 'ptt-start':
        if (ws.role !== 'viewer') break;
        resetPtt(ws);
        ws.ptt.active = true;
        ws.ptt.startedAt = Date.now();
        ws.ptt.lang = data.lang || config.whisperLang;
        break;

      case 'ptt-end':
        if (ws.role !== 'viewer') break;
        finishPtt(ws).catch((err) => log('ptt.error', { error: err.message }));
        break;

      case 'ptt-cancel':
        if (ws.role !== 'viewer') break;
        resetPtt(ws);
        break;

      // The iPad is in another room, in Guided Access, and cannot be picked
      // up and looked at. This is the only way to know it is actually well
      // rather than merely connected.
      case 'viewer-status':
        if (ws.role !== 'viewer') break;
        state.viewer = {
          at: Date.now(),
          fps: data.fps, render: data.render, source: data.source,
          incoming: data.incoming, monitor: data.monitor, mic: data.mic,
          muted: !!data.muted, ui: data.ui, wakeLock: !!data.wakeLock,
        };
        sendToController({ type: 'viewer-status', ...data, timestamp: state.viewer.at });
        break;

      // Reload the surface from her side. After a reload the page re-acquires
      // the microphone without a gesture (the permission persists) and the
      // sound choice is remembered, so it comes back on its own.
      case 'reload-viewer':
        if (ws.role !== 'controller') break;
        log('viewer.reload-requested', { viewers: clients.viewers.size });
        broadcastToViewers({ type: 'reload-viewer' });
        break;

      case 'monitor-status':
        if (ws.role !== 'controller') break;
        if (state.monitorUp !== !!data.up) log('monitor.status', { up: !!data.up });
        state.monitorUp = !!data.up;
        break;

      case 'feed-status':
        if (ws.role !== 'controller') break;
        if (state.feed.video !== !!data.video || state.feed.audio !== !!data.audio) {
          log('feed.status', { video: !!data.video, audio: !!data.audio });
        }
        state.feed = { video: !!data.video, audio: !!data.audio };
        break;

      case 'clear-cache':
        if (ws.role !== 'controller') break;
        cachedOffer = null;
        cachedIceCandidates = [];
        log('cache.cleared', {});
        break;
    }
  });

  ws.on('close', () => {
    const wasViewer = clients.viewers.delete(ws);

    if (clients.controller === ws) {
      clients.controller = null;
      cachedOffer = null;
      cachedIceCandidates = [];
      state.monitorUp = false;
      state.feed = { video: false, audio: false };
      log('controller.disconnect', { note: 'cache cleared' });
    }

    if (wasViewer) {
      if (clients.viewers.size === 0) state.viewer = null;
      log('viewer.disconnect', { remaining: clients.viewers.size });
      sendToController({ type: 'viewer-count', count: clients.viewers.size });
    }
    resetPtt(ws);
  });

  ws.on('error', (err) => log('ws.error', { error: err.message }));
});

// Server side heartbeat: ping every 25 s, terminate after two missed pongs.
// The client side heartbeat (hb / hb-ack) catches the half open sockets that
// a TCP level ping does not.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.missedPongs += 1;
      if (ws.missedPongs >= 2) {
        log('ws.terminate', { reason: 'missed pongs', role: ws.role || 'unknown' });
        return ws.terminate();
      }
    }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  });
}, config.heartbeatServerMs).unref();

// ---------------------------------------------------------------- boot
server.listen(PORT, () => {
  log('server.start', { mode: config.mode, scheme, port: PORT });
  console.log('');
  console.log(`  NICKII AI  ${scheme}://nickii.local:${PORT}`);
  console.log(`  visitor    ${scheme}://nickii.local:${PORT}/`);
  console.log(`  controller ${scheme}://nickii.local:${PORT}/control`);
  console.log(`  health     ${scheme}://nickii.local:${PORT}/health`);
  console.log('');
});

server.on('error', (err) => {
  log('server.error', { error: err.message, code: err.code });
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Another NICKII server is running.`);
    console.error(`  Stop it first:  launchctl bootout gui/$(id -u)/com.nickii.ai\n`);
  }
  process.exit(1);
});

// Exit rather than linger in an unknown state. The LaunchAgent restarts us
// within seconds and both clients reconnect on their own backoff, which is far
// safer for a six hour unattended run than a process that is alive but wedged.
process.on('uncaughtException', (err) => {
  log('fatal', { error: err.message, stack: (err.stack || '').split('\n')[1] });
  setTimeout(() => process.exit(1), 150);
});
