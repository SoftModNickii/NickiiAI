// Protocol regression test for the server.
//
//   node tests/protocol.js
//
// Stubs whisper, then drives a controller and two viewers through the whole
// signaling protocol and asserts what each side receives. It runs against its
// own server instance on its own ports, so it never disturbs a live rehearsal.
//
// Section 6 of NICKIIAI.md is the contract. The preserved half of it (roles,
// cached offer replay, ICE routing, return-feed) is what the original working
// project depended on, and it is the half most easily broken by accident.

const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const PORT = process.env.TEST_PORT || 8444;
const WPORT = process.env.TEST_WHISPER_PORT || 8179;
const BASE = `https://127.0.0.1:${PORT}`;
const WebSocket = require(path.join(REPO, 'node_modules/ws'));

let failures = 0;
const results = [];
const check = (name, ok, detail) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- stub whisper
let whisperCalls = 0;
let nextText = { text: ' Hallo, wie geht es dir? ', language: 'de' };
let multipart = null;

const whisper = http.createServer((req, res) => {
  if (req.method === 'GET') { res.writeHead(200); return res.end('stub'); }
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    whisperCalls++;
    const body = Buffer.concat(chunks);
    const m = /boundary=(.+)$/.exec(req.headers['content-type'] || '');
    if (m) {
      const b = Buffer.from('--' + m[1]);
      const parts = [];
      let i = body.indexOf(b);
      while (i !== -1) {
        const next = body.indexOf(b, i + b.length);
        if (next === -1) break;
        parts.push(body.slice(i + b.length, next));
        i = next;
      }
      const file = parts.find((p) => p.includes('name="file"'));
      if (file) {
        const wav = file.slice(file.indexOf('\r\n\r\n') + 4, file.length - 2);
        multipart = {
          riff: wav.toString('ascii', 0, 4), wave: wav.toString('ascii', 8, 12),
          channels: wav.readUInt16LE(22), sampleRate: wav.readUInt32LE(24),
          bits: wav.readUInt16LE(34), dataBytes: wav.readUInt32LE(40),
          actualBytes: wav.length - 44,
          hasLang: parts.some((p) => p.includes('name="language"')),
        };
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(nextText));
  });
});

// ---------------------------------------------------------------- helpers
const get = (p) => new Promise((resolve, reject) => {
  https.get(BASE + p, { rejectUnauthorized: false }, (res) => {
    const c = [];
    res.on('data', (x) => c.push(x));
    res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
  }).on('error', reject);
});

function client() {
  const ws = new WebSocket(BASE.replace('https', 'wss'), { rejectUnauthorized: false });
  const inbox = [];
  ws.on('message', (d, isBinary) => {
    if (isBinary) return inbox.push({ type: '__binary', bytes: d.length });
    try { inbox.push(JSON.parse(d.toString())); } catch (e) {}
  });
  return new Promise((resolve) => ws.on('open', () => resolve({
    ws, inbox,
    send: (o) => ws.send(JSON.stringify(o)),
    raw: (b) => ws.send(b),
    got: (t) => inbox.filter((m) => m.type === t),
    last: (t) => inbox.filter((m) => m.type === t).pop(),
  })));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- run
(async () => {
  await new Promise((r) => whisper.listen(WPORT, '127.0.0.1', r));

  const server = spawn('node', ['server.js'], {
    cwd: REPO,
    env: { ...process.env, NICKII_PORT: PORT, NICKII_WHISPER_URL: `http://127.0.0.1:${WPORT}/inference` },
    stdio: 'ignore',
  });

  // Wait for it to answer rather than guessing at a delay.
  for (let i = 0; i < 40; i++) {
    try { await get('/health'); break; } catch (e) { await wait(250); }
  }

  try {
    // ---- static surface
    const [health0, cfg, idx, ctl, shared, worklet, icon, font] = await Promise.all(
      ['/health', '/config.json', '/', '/control', '/shared.js', '/worklet-capture.js',
       '/icons/apple-touch-icon.png', '/fonts/archivo-latin.woff2'].map(get));

    check('GET /health', health0.status === 200 && JSON.parse(health0.body).ok === true);
    check('no STUN in local mode', JSON.parse(cfg.body).iceServers.length === 0);
    check('config carries capture constraints', JSON.parse(cfg.body).capture.width === 1920);
    check('config carries render settings', JSON.parse(cfg.body).render.bicubic === true);
    check('visitor surface serves', idx.status === 200 && idx.body.includes('Hold to speak'));
    check('controller serves', ctl.status === 200 && ctl.body.includes('id="stream"'));
    check('shared.js serves', shared.status === 200 && shared.body.includes('NickiiNet'));
    check('worklet serves', worklet.status === 200 && worklet.body.includes('capture-processor'));
    check('icon serves', icon.status === 200 && icon.body.length > 1000);

    // The gallery has no uplink: a webfont from Google would resolve to nothing
    // there and both surfaces would fall back to the system font on show day.
    check('Archivo is self-hosted', font.status === 200 && font.body.length > 20000);
    check('no font loaded from the internet',
      !/fonts\.googleapis|fonts\.gstatic/.test(idx.body + ctl.body));

    check('no TTS anywhere', !/speechSynthesis|piper|ttsToWav/i.test(idx.body + ctl.body));
    check('the controller asks for a resolution',
      ctl.body.includes('width: { ideal:') && ctl.body.includes("contentHint = 'detail'"));
    check('the sender holds resolution over frame rate',
      ctl.body.includes("degradationPreference = 'maintain-resolution'"));
    check('shader radii are in source pixels', idx.body.includes('vec2 d = 1.0 / uSrc;'));
    check('shader uses highp for the bicubic', idx.body.includes('precision highp float;'));
    check('the edge is the interface, not an orb',
      idx.body.includes('id="edge"') && !idx.body.includes('id="orb"'));
    check('a stale pointer cannot lock the button',
      idx.body.includes('if (pointerId !== null) { clearTimeout(holdTimer); pointerId = null; }'));
    check('a message locks the surface while it is in flight',
      idx.body.includes('function hold()') && idx.body.includes('if (busy) return;'));

    // Every CSS block balances. An extra brace once silently voided the whole
    // layout in portrait, and nothing on screen said so.
    for (const [name, page] of [['client', idx.body], ['controller', ctl.body]]) {
      const blocks = page.match(/<style>[\s\S]*?<\/style>/g) || [];
      const bad = blocks.filter((b) => {
        const c = b.replace(/\/\*[\s\S]*?\*\//g, '');
        return (c.match(/{/g) || []).length !== (c.match(/}/g) || []).length;
      });
      check(`${name} CSS braces balance`, bad.length === 0, `${blocks.length} block(s)`);
    }

    const base = JSON.parse(health0.body).viewerCount;

    // ---- preserved signaling
    const ctrl = await client();
    ctrl.send({ type: 'register-controller' });
    await wait(120);
    check('controller gets viewer-count on register', !!ctrl.last('viewer-count'));

    const v1 = await client();
    v1.send({ type: 'register-viewer' });
    await wait(140);
    check('no cache means the controller is asked for an offer', ctrl.got('request-offer').length === 1);
    check('controller sees the viewer', ctrl.last('viewer-count').count === base + 1);

    ctrl.send({ type: 'webrtc-offer', offer: { type: 'offer', sdp: 'SDP_AV' } });
    ctrl.send({ type: 'webrtc-ice-candidate', candidate: { candidate: 'host1' }, target: 'viewer' });
    await wait(140);
    check('viewer receives the offer', v1.last('webrtc-offer').offer.sdp === 'SDP_AV');
    check('viewer receives the ICE candidate', v1.last('webrtc-ice-candidate').candidate.candidate === 'host1');

    v1.send({ type: 'webrtc-answer', answer: { sdp: 'ANSWER' }, target: 'controller' });
    v1.send({ type: 'webrtc-ice-candidate', candidate: { candidate: 'host2' }, target: 'controller' });
    await wait(140);
    check('controller receives the answer', ctrl.last('webrtc-answer').answer.sdp === 'ANSWER');
    check('controller receives the viewer ICE', ctrl.last('webrtc-ice-candidate').candidate.candidate === 'host2');

    const v2 = await client();
    v2.send({ type: 'register-viewer' });
    await wait(160);
    check('late viewer gets the cached offer', !!v2.last('webrtc-offer'));
    check('late viewer gets the cached ICE', v2.got('webrtc-ice-candidate').length === 1);
    check('no second request-offer was needed', ctrl.got('request-offer').length === 1);

    // ---- monitor feed
    v1.send({ type: 'return-feed-offer', offer: { sdp: 'MON_OFFER' }, target: 'controller' });
    await wait(110);
    check('monitor offer reaches the controller', ctrl.last('return-feed-offer').offer.sdp === 'MON_OFFER');
    ctrl.send({ type: 'return-feed-answer', answer: { sdp: 'MON_ANSWER' }, target: 'viewer' });
    await wait(110);
    check('monitor answer reaches the viewer', v1.last('return-feed-answer').answer.sdp === 'MON_ANSWER');

    // ---- heartbeat and status
    v1.send({ type: 'hb' });
    ctrl.send({ type: 'feed-status', video: true, audio: true });
    ctrl.send({ type: 'monitor-status', up: true });
    await wait(140);
    check('hb is answered with hb-ack', !!v1.last('hb-ack'));
    const h1 = JSON.parse((await get('/health')).body);
    check('health reports the outgoing feed', h1.outgoingFeed.video && h1.outgoingFeed.audio);
    check('health reports the monitor up', h1.monitorFeedUp === true);

    // ---- PTT
    v1.raw(Buffer.alloc(32000));
    await wait(160);
    check('binary outside a PTT session is dropped', whisperCalls === 0);

    v1.send({ type: 'ptt-start', lang: 'auto' });
    for (let i = 0; i < 8; i++) v1.raw(Buffer.alloc(4000));
    await wait(130);
    v1.send({ type: 'ptt-end' });
    await wait(450);

    check('whisper was called once', whisperCalls === 1);
    check('a valid 16 kHz mono WAV was sent',
      multipart && multipart.riff === 'RIFF' && multipart.channels === 1
      && multipart.sampleRate === 16000 && multipart.bits === 16);
    check('WAV length matches its header',
      multipart && multipart.dataBytes === multipart.actualBytes && multipart.dataBytes === 32000);
    const t1 = v1.last('transcript');
    check('viewer gets the transcript', t1 && t1.text === 'Hallo, wie geht es dir?');
    check('the other viewer does not', v2.got('transcript').length === 0);
    const p1 = ctrl.last('prompt');
    check('controller gets it as a voice prompt', p1 && p1.source === 'voice');
    check('detected language passes through', p1 && p1.lang === 'de');

    nextText = { text: 'Vielen Dank.', language: 'de' };
    v1.send({ type: 'ptt-start' });
    for (let i = 0; i < 8; i++) v1.raw(Buffer.alloc(4000));
    await wait(90);
    v1.send({ type: 'ptt-end' });
    await wait(450);
    check('a known hallucination is dropped', v1.last('transcript').error === true);
    check('no prompt forwarded for junk', ctrl.got('prompt').length === 1);

    const before = whisperCalls;
    v1.send({ type: 'ptt-start' });
    for (let i = 0; i < 4; i++) v1.raw(Buffer.alloc(4000));
    await wait(90);
    v1.send({ type: 'ptt-cancel' });
    await wait(260);
    check('ptt-cancel never reaches whisper', whisperCalls === before);

    v1.send({ type: 'ptt-start' });
    v1.raw(Buffer.alloc(400));
    await wait(70);
    v1.send({ type: 'ptt-end' });
    await wait(260);
    check('a tap is rejected without calling whisper', whisperCalls === before);

    nextText = { text: 'Long one.', language: 'en' };
    v1.send({ type: 'ptt-start' });
    for (let i = 0; i < 40; i++) v1.raw(Buffer.alloc(32000));
    await wait(220);
    v1.send({ type: 'ptt-end' });
    await wait(520);
    check('audio past 30 s is capped', multipart.dataBytes === 30 * 16000 * 2,
      `${multipart.dataBytes} bytes`);

    v2.send({ type: 'prompt', text: 'typed message' });
    await wait(140);
    check('typed prompts still relay', ctrl.got('prompt').pop().text === 'typed message');

    // ---- teardown
    v2.ws.close();
    await wait(260);
    check('controller is told the viewer left', ctrl.last('viewer-count').count === base + 1);

    ctrl.ws.close();
    await wait(260);
    const h3 = JSON.parse((await get('/health')).body);
    check('cache cleared on controller disconnect', h3.offerCached === false);
    check('monitor and feed flags reset', !h3.monitorFeedUp && !h3.outgoingFeed.video);

    v1.ws.close();
  } finally {
    server.kill();
    whisper.close();
  }

  console.log('\nProtocol\n');
  console.log(results.map((r) => '  ' + r).join('\n'));
  console.log(failures === 0
    ? `\nAll ${results.length} checks passed.\n`
    : `\n${failures} of ${results.length} failed.\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('crashed:', e); process.exit(2); });
