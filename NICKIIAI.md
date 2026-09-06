# NICKII AI

Project specification for the Ars Electronica Campus Exhibition installation (Linz, September 2026).
This file is the single source of truth for the build. Read it fully before writing any code.

---

## 1. What this is

A two-device performance installation by Nickii Schamborski. The visitor believes they are talking to an AI. In reality, Nickii is the AI, live.

- **iPad = visitor surface.** A single glass interface in the gallery, presented as the product **NICKII AI** at **`https://nickii.ai`**. The screen constantly shows Nickii's live face, rendered on the device so it reads as a machine's picture of a face rather than a video call, and the visitor hears her live voice. Visitors press and hold to speak a "message to the AI", release, and see it sent.
- **MacBook Pro = Nickii's side + server + network.** It creates its own Wi-Fi network, serves the app over local HTTPS, runs signaling and Whisper locally, and streams her outgoing feed. Nickii wears an earpiece connected to the Mac.

**The core mechanic (this is the piece, get it right):**

1. **Outgoing feed (Nickii to visitor, constant):** Nickii's face is streamed live to the iPad the whole time, exactly like the former project streamed the controller feed. She live-edits the video image in **OBS with foot pedals** (scene switches, effects); the browser simply consumes **OBS Virtual Camera** as its video source. Her live voice travels on the same WebRTC connection as an audio track. There is **no synthetic voice and no TTS anywhere in this system.** When the machine speaks, it is her, live.
   On arrival the iPad puts the picture through a **render pass** (section 9b) that dissolves the video frame entirely and finishes the image, so the visitor meets a presence rather than a webcam window.
2. **Incoming feed (visitor to Nickii, constant, hidden):** the iPad microphone is continuously open and streams live audio to the Mac at all times. Nickii hears the room and the visitors in her earpiece the entire time, not just during holds.
3. **The performed message layer:** the visible interaction is push to talk. While the visitor holds the surface, the system marks an utterance; on release it is transcribed locally by Whisper and appears on Nickii's screen as a discrete, finished, sent message (with a soft cue in her earpiece). This is the fiction of talking to a machine, and it is also genuinely useful: clean text and clear message boundaries in real time, on top of what she already hears.

There is **no internet dependency**. Everything runs offline on the MacBook's own network. The existing Render deployment stays behind one config flag as a fallback.

An earlier version (Express + ws signaling with cached offer/ICE for late-joining viewers, plus return-feed signaling channels) works. Its signaling logic must be preserved and extended, not rewritten.

## 2. Locked decisions (do not revisit)

1. MacBook acts as the router. Fully offline capable. Venue Wi-Fi is never used for the device link.
2. Local HTTPS with a mkcert-issued certificate trusted on the iPad. Mandatory: `getUserMedia` only works in a secure context, and `http://192.168.x.x` is not one.
2b. **The visitor never sees an IP address.** The installation answers at `https://nickii.ai`, resolved by `scripts/dns.js` on the Mac and reachable only on this network. Port 443 reaches the app through a pf redirect (`scripts/setup-port443.sh`) so no port number appears either. `nickii.local:8443` and the raw IP stay as fallbacks and are covered by the same certificate.
3. **No TTS, no synthetic voice, no generated replies.** The reply channel is Nickii's live face and live voice. Do not build a reply composer, a TTS engine hook, or any text-to-speech path.
4. **Outgoing A/V capture on the controller:** video device **"OBS Virtual Camera"**, audio device **"BlackHole 2ch"** (OBS audio monitoring routed into BlackHole), selected via `getUserMedia` device selection with a device picker in the hidden operator panel. This makes OBS the single mixing brain: her foot pedals control both image and sound (scene switches, effect toggles, audio mute) without touching the browser. Fallback if BlackHole is not set up: capture her physical mic directly.
5. **Dual audio path from the iPad, one mic stream, two consumers:**
   - **Monitor feed (continuous):** WebRTC audio track from iPad to Mac, always on, played only into Nickii's earpiece. Reuses the existing `return-feed-*` signaling types. Never recorded to disk, never sent to Whisper.
   - **Message path (gated):** while PTT is held, 16 kHz PCM chunks go over the secure WebSocket; on release the segment goes to Whisper. Whisper only ever sees PTT-gated audio (keeps its noise-hallucination problem out of the system even though the mic itself is always open).
6. Speech-to-text on the Mac via **whisper.cpp in server mode** (model stays loaded), model `large-v3-turbo`, English and German, auto-detect.
7. UI: soft spatial computing in a **light key, neutral, with her face as the only colour** (section 11). Her rendered face is the content; the interface defers to it. One glass pane per device. The surface carries just enough product framing to be believable (a **NICKII AI** wordmark, a live status pill, a quiet `nickii.ai` footer) and no more. No chat bubbles, no robot or sparkle iconography, no saturated "AI purple", no dashboards.
8. Stack stays **vanilla HTML/CSS/JS + Node**. No frameworks, no bundler, no build step, no TypeScript.
9. No STUN, no TURN. Same subnet, host ICE candidates only.
10. **Privacy defaults:** the continuous monitor feed is live-only and is never written to disk. Only PTT segments are processed, and only their transcripts are logged. Whether and how the continuous listening is disclosed to visitors (signage, program text) is an artistic and production decision Nickii settles with the festival team; the system must not silently record.

## 2b. Pre-production checklist (owner: Nickii, not the coding AI)

- [ ] Verify the dummy-source Internet Sharing trick on the exact macOS version of the MacBook (weeks before Linz).
- [ ] Run the full mkcert + AirDrop + full-trust flow once on the actual exhibition iPad.
- [ ] Set up the OBS chain: scenes and effects on the foot pedals, Virtual Camera output, audio monitoring routed to BlackHole (install BlackHole 2ch), and confirm the pedal also mutes/unmutes her mic inside OBS.
- [ ] Clarify with the Ars Electronica production team (Gordon / Violeta) how audio capture of visitors is handled in the Campus space, and decide the disclosure/signage approach for the continuous listening.
- [ ] Decide earpiece hardware for show days (wired recommended over AirPods for reliability).
- [ ] Decide her performance position (hidden, distant, or visible elsewhere) so her acoustic voice does not reach the iPad area directly.
- [ ] Tune `config.render` against her actual OBS lighting and exposure (an hour on the exhibition iPad, section 9b). The defaults are a starting point, not a decision.
- [ ] Decide the iPad's mounting orientation, then set the **OBS canvas to match it** and update `config.capture` to the same numbers. A landscape canvas on a portrait-mounted iPad throws away the sides and enlarges the rest, and it is the cheapest picture quality left on the table.

## 3. Repo structure

```
nickii-ai/
  server.js              # HTTPS + WSS + signaling + voice ingest + whisper bridge
  config.js              # single config: mode, ports, paths, timings, devices, render
  certs/                 # mkcert output (gitignored)
  logs/                  # one line per event, transcripts only (gitignored)
  public/
    client.html          # iPad visitor surface (single file: HTML+CSS+JS+GLSL)
    control.html         # Nickii's controller surface (single file)
    shared.js            # WS reconnect/heartbeat helper used by both pages
    worklet-capture.js   # AudioWorkletProcessor: mic to 16kHz mono Int16 PCM
    fonts/               # Archivo, self-hosted: the gallery has no uplink
    icons/               # generated, see scripts/make-icons.js
  scripts/
    setup-network.md     # runbook (section 4)
    setup-https.sh       # mkcert cert generation, covers every name in use
    dns.js               # answers nickii.ai on this network, forwards the rest
    setup-port443.sh     # pf redirect so the address carries no port
    start-whisper.sh     # whisper-server with the turbo model
    make-icons.js        # generates the app icons, no dependencies
    com.nickii.ai.plist       # LaunchAgent keeping server.js alive
    com.nickii.whisper.plist  # LaunchAgent keeping whisper alive
  tests/                 # npm test: resampler, protocol, pages, layout
  render.yaml            # unchanged, cloud fallback
  NICKIIAI.md            # this file
```

## 4. Network runbook (MacBook as router, no internet)

Goal: the MacBook broadcasts Wi-Fi `NICKII`, the iPad joins it, the Mac is reachable at a fixed address. No uplink required.

1. **Set the Mac's hostname** for a stable mDNS name:
   System Settings > General > About > Name: `nickii` (reachable as `nickii.local`).
   Terminal: `sudo scutil --set HostName nickii && sudo scutil --set LocalHostName nickii`
2. **Create the network with Internet Sharing using a dummy source.** macOS cannot share Wi-Fi over Wi-Fi, but it does not need a real uplink to broadcast an access point:
   - System Settings > General > Sharing > Internet Sharing (info icon).
   - "Share your connection from": **Thunderbolt Bridge** (or any unused Ethernet/USB adapter, nothing needs to be plugged into it).
   - "To devices using": **Wi-Fi**.
   - Wi-Fi Options: name `NICKII`, **WPA3 Personal**, strong password.
   - Toggle on. The Mac becomes gateway **192.168.2.1** with its own DHCP. Verify: `ifconfig bridge100`.
3. **iPad**: join `NICKII`. "No Internet Connection" is expected and fine. Forget or disable Auto-Join on all other saved networks on the exhibition iPad; disable Ask to Join Networks.
4. **The address.** The app lives at **`https://nickii.ai`**. Two pieces make that true, and both belong in the show runbook because neither survives a reboot:
   - `sudo node scripts/dns.js` answers `nickii.ai` (and any subdomain) with the Mac's address, and forwards every other name to the Mac's real resolver, so pointing a device at it does not cost that device the rest of the internet. Offline in the gallery those forwards simply time out, which is correct: hers is the only name that resolves there.
   - `sudo ./scripts/setup-port443.sh` redirects inbound 443 to the app on 8443, so no port shows in the URL. Reversible with `--off`, scoped to traffic addressed to this Mac, and it backs up `/etc/pf.conf` before touching it.
   - On the iPad, once: Settings > Wi-Fi > (i) > Configure DNS > Manual, and set the Mac (`192.168.2.1` on the show network).
   - Fallbacks, same certificate: `https://nickii.local:8443` and `https://192.168.2.1:8443`.
5. **Fallback ladder**: (a) small travel router (GL.iNet class) hosting the private network, Mac keeps the same hostname/cert; (b) Render cloud mode via the config flag.

Verify the dummy-source Internet Sharing trick on the exact macOS version in Phase 1, weeks before Linz. If sharing from an inactive interface is refused, plug in any USB Ethernet adapter (attached to nothing) or move to the travel router.

## 5. HTTPS runbook

1. On the Mac: `brew install mkcert && mkcert -install`.
2. `./scripts/setup-https.sh` generates the cert covering every name the iPad might use: `nickii.ai`, `www.nickii.ai`, `nickii.local`, `192.168.2.1`, `localhost`, `127.0.0.1`, plus this Mac's current hostname and LAN addresses (detected at run time, so the same certificate works on a test network and in Linz). Run `mkcert -install` too, so the Mac's own browsers trust it.
3. Find the CA root: `mkcert -CAROOT` (contains `rootCA.pem`).
4. **AirDrop `rootCA.pem` to the iPad** (AirDrop is peer to peer and works offline). On the iPad:
   - Open the file ("Profile Downloaded").
   - Settings > General > VPN & Device Management > install the profile.
   - Settings > General > About > Certificate Trust Settings > enable **full trust** for the mkcert root. Easy to forget; everything silently fails without it.
5. `server.js` serves HTTPS with that cert; the WebSocket is `wss://` on the same origin.
6. One time on the iPad: open the URL, grant the microphone permission once, add to Home Screen. Grant permission **before** entering Guided Access.

Check cert expiry during the pre-show checklist in September.

## 6. Server spec (`server.js`)

Preserve the existing signaling protocol exactly, then extend it.

**Keep as-is (conceptually identical to the current working server):**
- Roles: `register-viewer`, `register-controller`, viewer set + single controller.
- Cached last `webrtc-offer` and ICE candidates, replayed to late-joining viewers; cache cleared on controller register/disconnect; `request-offer` when no cache exists. The controller's offer now includes both a video track (OBS Virtual Camera) and an audio track (her live voice); the signaling does not change, only the SDP content does.
- `webrtc-answer` to controller, `webrtc-ice-candidate` routed by `target`, `viewer-count`, `prompt` relay, and the `return-feed-*` signaling routing (carrying the continuous monitor feed: an iPad-to-Mac WebRTC audio connection negotiated through these existing types).

**Change/add:**
1. **HTTPS + WSS** using `certs/` paths from `config.js`, port 8443.
2. **Heartbeat.** Server pings every client every 25 s, terminates after 2 missed pongs. Clients send `{"type":"hb"}` every 20 s; server replies `{"type":"hb-ack"}` (detects half-dead sockets from the client side too).
3. **PTT message ingest.** Per-connection session:
   - `{"type":"ptt-start","lang":"auto"}` opens a session.
   - Binary frames from a viewer while a session is open are Int16 PCM 16 kHz mono chunks; append. Hard cap 30 s.
   - `{"type":"ptt-end"}`: wrap PCM in a 44-byte WAV header (written in Node, no dependency), POST to the whisper server, then:
     - `{"type":"transcript","text":...,"final":true}` back to that viewer, and
     - `{"type":"prompt","text":...,"source":"voice","timestamp":...}` to the controller through the existing prompt path.
   - `{"type":"ptt-cancel"}` discards.
   - On whisper failure or empty result: `{"type":"transcript","text":"","final":true,"error":true}`, no prompt forwarded.
4. **Junk filter.** Trim; drop under 2 characters; drop punctuation-only and known Whisper hallucination strings (list in `config.js`).
5. **Status endpoint.** `GET /health`: uptime, controller connected, viewer count, whisper reachable, monitor feed up (controller reports via `{"type":"monitor-status","up":true|false}`), outgoing feed up (controller reports via `{"type":"feed-status","video":true,"audio":true}`), last transcript age.
6. **Logging.** One line per event to `logs/nickii-YYYYMMDD.log`. Transcripts are logged; **neither the monitor feed nor the outgoing A/V is ever recorded anywhere**.

**Protocol summary:** all existing types unchanged, plus `hb`, `hb-ack`, `ptt-start`, `ptt-end`, `ptt-cancel`, `transcript`, `monitor-status`, `feed-status`, `viewer-status`, `reload-viewer`. Binary frames exist in one direction only: viewer to server, PCM chunks during a PTT session.

## 7. Config (`config.js`)

```js
module.exports = {
  mode: process.env.NICKII_MODE || 'local',   // 'local' | 'render'
  httpsPort: 8443,
  certPath: './certs/nickii.local.pem',
  keyPath: './certs/nickii.local-key.pem',
  whisperUrl: 'http://127.0.0.1:8178/inference',
  whisperLang: 'auto',
  preferredDevices: {                          // matched by label substring in the controller
    video: 'OBS Virtual Camera',
    audio: 'BlackHole',
  },
  capture: {                                   // what the controller asks OBS for, section 10
    width: 1920, height: 1080, frameRate: 30, maxBitrate: 12000000,
  },
  render: {                                    // the iPad render pass, section 9b
    sharpen: 0.28, clarity: 0.40, bloom: 0.40, lightWrap: 0.50, saturation: 0.90,
    bicubic: true, maxPixels: 6000000,
  },
  maxUtteranceSeconds: 30,
  heartbeatServerMs: 25000,
  heartbeatClientMs: 20000,
  reconnect: { baseMs: 1000, maxMs: 30000, factor: 2, jitter: 0.1 },
  watchdogNoFeedMs: 15000,
  watchdogReloadMs: 45000,
  junkTranscripts: ['thank you.', 'thanks for watching', 'untertitel im auftrag des zdf', 'vielen dank.'],
};
```
Clients derive the socket URL from their own origin (`wss://` + `location.host`), with a Render override when served from `onrender.com`, so the same files work in both modes with zero edits.

## 8. Whisper pipeline (Mac)

1. `brew install whisper-cpp`. Model `ggml-large-v3-turbo.bin` in `~/models/` (English and German in one model).
2. `scripts/start-whisper.sh`: `whisper-server -m ~/models/ggml-large-v3-turbo.bin --host 127.0.0.1 --port 8178 -t 8`. Model stays loaded; per-utterance latency is transcription only (roughly 1 to 2 s for a short prompt on M-series).
3. whisper-server is bound to localhost only, never exposed on the Wi-Fi network.

## 9. iPad client spec (`client.html`)

**Web app shell**
- Meta tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `viewport-fit=cover`, apple-touch-icon. Launched from the Home Screen, no Safari chrome.
- Screen Wake Lock (`navigator.wakeLock.request('screen')`, re-acquired on `visibilitychange`; needs iPadOS 18.4+ inside a Home Screen web app), plus Guided Access and Auto-Lock Never as the real safety net.

**Product framing**
- A **NICKII AI** wordmark top left ("AI" set in `--ink-lo`, never a colour), a live status pill top right reading `ONLINE` in SF Mono and turning amber on `RECONNECTING`, and a quiet footer reading `nickii.ai · Conversational Intelligence`. Enough to be believable as a product, quiet enough to stay out of the interaction. Nothing here is interactive.

**The live feed (the content)**
- The remote stream (Nickii's OBS-edited face + her live voice) fills the screen behind the interface: `<video autoplay playsinline>` **not muted**, `object-fit: cover`. This is a constant presence and is never dimmed away. It is not shown raw: it goes through the render pass in 9b, which is what stops it reading as a video call.
- **Unmuted autoplay sequencing (important):** WebKit permits unmuted playback when the page is actively capturing. Initialization order on the one-time setup tap: (1) `getUserMedia` for the mic, (2) establish both peer connections, (3) attach the remote stream and call `play()`. After that the page runs unattended; the watchdog reload path must re-run the same sequence without a tap (a page that reloads while holding the mic permission can re-acquire capture programmatically; verify this on the exhibition iPadOS in Phase 3, and if a gesture turns out to be required after reload, the reload fallback shows a minimal full-screen "touch to wake" glass state rather than failing silently).

## 9b. The render pass (the thing that makes her an entity)

A raw full-bleed camera feed reads as a video call: it has a rectangle, corners, and a room
behind it. The iPad therefore renders her rather than displaying her. One WebGL fragment
shader, one fullscreen pass, driven from `config.render`:

0. **Bicubic reconstruction** (`bicubic`), Catmull-Rom in nine bilinear fetches. The panel has
   far more pixels than the stream does, so almost every pixel on screen is invented. Bilinear
   invents them by drawing straight lines between samples, which is exactly what "pixelated"
   looks like; Catmull-Rom reconstructs the curve instead. On an iPad panel this is the single
   biggest visible difference in the whole pass. It needs `highp` in the fragment shader: the
   maths is in source pixel coordinates, and `mediump` cannot count to 1920.
1. **Sharpen** (`sharpen`), a one pixel unsharp cross. Deliberately low: camera noise lives at
   this radius too, and lifting it is what makes video look cheap.
2. **Clarity** (`clarity`), the same operation at a five pixel radius. This is local contrast
   rather than edge sharpening, so it finds structure and not grain. This is the part that
   reads as "rendered".

   Both radii are measured in **source** pixels, never canvas pixels. Measured against the
   canvas they shrink below one source pixel as soon as the image is enlarged, and then they
   sharpen the interpolation instead of her.
3. **Bloom** (`bloom`), a wide eight tap ring, thresholded so only real highlights spill light.
4. **Grade**, a gentle S curve, a little saturation out (`saturation`), a little warmth in.
   Deliberately small: **colour grading belongs to OBS and her pedals**, this is only the finish.
5. **Light wrap** (`lightWrap`), the field's own colour bleeding onto her edges as they
   dissolve, so she is lit into the surface instead of cut out of it. This is the single
   biggest reason the composite reads as real.
6. **The dissolve**, an elliptical falloff written straight into the alpha channel. Cleaner
   than masking the element, and free in the same pass.

7. **Refraction through the glass pane** (`render.glass`). `backdrop-filter` only blurs what is
   behind a panel. Real glass also *bends* it, and that bend is the whole tell of the material.
   Inside a band at the pane's rim the image is displaced along the surface normal of a rounded
   rect SDF, the colour channels are displaced by slightly different amounts (chromatic
   aberration, the colour fringing at a glass edge), and the rim softens into the wide bloom
   sample (spherical aberration, a lens losing focus away from its centre). The pane's geometry
   is read from the live element every frame, so the refraction can never drift out of register
   with the border the visitor sees. CSS keeps the frost and the specular rim; the shader does
   the part CSS cannot.

   This is Apple's Liquid Glass behaviour (iOS/macOS 26) rather than a decorative blur, which is
   what makes the surface read as current rather than as a 2023 glassmorphism card.

**The breath belongs in the shader, never on the canvas.** A CSS transform on the drawing buffer
makes the compositor resample every rendered pixel through a non integer scale, which silently
undoes the sharpening and the bicubic both. Render 1:1 to the panel and drift in sample space
instead: the form then stays put while the image moves inside it, which also reads better, a
presence shifting within itself rather than a video sliding about.

**Composition** (`faceY`, `ovalWidth`, `ovalHeight`). Both radii are in units of screen
**height**, never per axis, so the oval stays head shaped whichever way the iPad is mounted.
Measured per axis it sprawls across a landscape screen and leaves the room on show, which is
the one thing the dissolve exists to prevent. Dial the three numbers against her real OBS
framing rather than guessing: `faceY` moves her up and down, smaller radii crop in tighter and
hide more of the room.

`ovalHeight` covers **head and shoulders**, not just the head. Cropped to the head alone the
glass pane floats over empty field with nothing behind it, so the refraction has nothing to
bend, and that is most of what sells the material.

There is no longer anything to land on her face. See section 11a: the orb is gone, and with it
the whole class of bug where the interface has to find somewhere to sit that is not on top of
her. Whatever replaces it in future must keep that property.

The oval is a crop, not a fix. It can hide a bad frame but it cannot invent one, and cropping
hard to a wide source means throwing away most of the pixels that were captured. **Portrait is
the stronger composition for this piece**: head and shoulders in a vertical frame reads as a
person present in the room, where a landscape frame reads as a video of one, and it wastes
half its width on the wall behind her. If the iPad is mounted portrait, the OBS canvas should
be portrait as well (section 10).

Rules:
- The `<video>` element stays in the DOM and keeps playing, because **it is still the source
  of her voice**. It sits behind the canvas at zero opacity.
- If WebGL is unavailable, or the context is lost, the canvas is dropped and the video shows
  through with an equivalent CSS mask. Her picture is never worth a risk.
- The drawing buffer renders at the panel's **real** pixels. Rendering smaller and letting the
  browser enlarge the result puts back precisely the softness this pass exists to remove.
  `render.maxPixels` is a thermal safety valve for a six hour run, not a quality decision, and
  lowering it costs sharpness directly. `powerPreference: 'low-power'`.
- Texture upload and draw happen inside the same `requestVideoFrameCallback` that feeds the
  connection watchdog, so there is one loop, not two.

**Audio graph (one mic, two consumers)**
- `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } })`. **Echo cancellation must stay ON**: the iPad speaker plays her live voice constantly while its own mic streams to her earpiece and to Whisper; AEC is what keeps her voice from looping into her own ear and from contaminating transcripts. Do not add extra denoising (hurts Whisper).
- The stream feeds:
  1. the **monitor feed**: audio track on an iPad-to-Mac RTCPeerConnection negotiated over the existing `return-feed-*` messages, connected at page load, up permanently, independent of PTT;
  2. the **AudioWorklet** (`worklet-capture.js`): always running, but chunks are only forwarded as binary frames between `ptt-start` and `ptt-end`;
  3. an **AnalyserNode** (`fftSize: 2048`) driving the edge light while holding.

**Push to talk (the performed message)**
- The glass pane is the button. `pointerdown` starts (after 250 ms to ignore accidental taps), `pointerup`/`pointercancel` ends, slide off cancels.
- On release: a clear "sent" beat (the utterance visually seals and dissolves upward), the transcript is shown briefly so the visitor sees what the machine "heard", then the surface returns to rest. Her live face and voice carry the actual answer; the UI never simulates a machine reply.

**Connection layer (`shared.js`)**
- WSS + `register-viewer`; client heartbeat every 20 s expecting `hb-ack`; exponential backoff reconnect (1 s base, x2, 30 s cap, 10% jitter, reset after 60 s stable); `intentionalClose` flag.
- Watchdog: no video frames and no `hb-ack` for `watchdogNoFeedMs` triggers re-request/ICE restart, still dead at `watchdogReloadMs` triggers `location.reload()`. On every (re)connect, both peer connections re-establish automatically; cached-offer replay makes the incoming feed near-instant.

**States** (classes on `<body>`; her live feed is visible in all of them)
0. `boot` (the audio ritual). WebKit will not play unmuted audio without a gesture, and an
   installation that is silently muted looks exactly like one that is working. So the surface
   asks outright: the disc reads **Enable sound / Ton einschalten**, with a quiet **Continue
   without sound** beneath it. That tap is one gesture doing three jobs at once: it grants the
   microphone, it answers the audio question, and it runs `play()` inside a real click handler,
   which is the most reliable unmuted path the platform offers. The choice is remembered in
   `localStorage`, so a watchdog reload mid-show does not put the ritual in front of the next
   visitor. If unmuted playback is refused anyway, the surface falls back to **muted**, never to
   a dead screen, and shows **Sound is off. Tap to enable.** so it is always recoverable.
0b. `arriving`. She does not appear, she arrives. The presence blooms in over 1.6 s with no
   affordance on screen at all, then the control fades up beneath her. Nothing anywhere says
   connecting, establishing or reconnecting: the visitor is meeting someone, not watching a
   session negotiate. The status pill is hidden in `boot`, `wake` and `arriving`, because it
   states a fact and the fact is not true yet.
1. `idle` (attract loop): her face, a faint prismatic edge turning slowly around the screen, and one small capsule low on screen. EN "Hold to speak" with a smaller DE "Halten und sprechen". Short because it is an instruction, and an instruction that takes two lines to read is a bad one. The system's name lives in the footer instead: `nickii.ai · Artistic Neuronal System`. That is the right place for it, a product subtitle rather than a caption on her face, and it still tells the visitor exactly what they are being invited to address without ever saying assistant, chatbot, or model.
2. `listening` (holding): orb wakes and scales gently with live amplitude (1.0 to 1.15, soft inner glow, never an oscilloscope), hint text fades.
3. `sent` (released): the message seals and lifts away; brief transcript display; then back to `idle`. No spinners, no typing indicators, no simulated "AI is thinking" state, because the answer arrives as her live voice whenever she chooses to speak.
- Error path: `transcript` with `error:true` shows "Try again, a little closer." and returns to idle.
- All transitions honor `prefers-reduced-motion: reduce` (durations to 0.01 ms; orb becomes a static ring with opacity-only level).

## 10. Controller spec (`control.html`, Nickii's side)

- Registers as controller via `shared.js` and **publishes the outgoing feed**: `getUserMedia` selecting video by label match "OBS Virtual Camera" and audio by label match "BlackHole" (from `config.preferredDevices`), falling back to defaults with a device picker in the hidden operator panel.
- **Ask for the resolution, always.** `getUserMedia` with no `width`/`height` returns the browser default, which is 640x480, and the iPad then enlarges that three or four times to fill the panel. That is what a soft, pixelated picture actually is, and nothing downstream can recover detail that was never captured. Constraints come from `config.capture`. Set them to match the OBS canvas.
- **Hold the resolution on the wire.** The outgoing video track gets `contentHint = 'detail'` (a face holding still should spend its budget on resolution, not frame rate), and the sender gets `maxBitrate` from `config.capture` with `degradationPreference: 'maintain-resolution'`. Left alone, WebRTC assumes a hostile internet and quietly shrinks her to protect frame rate. This is a private LAN with no uplink, so there is nothing to protect against and no reason to be frugal.
- **Orientation matters as much as resolution.** A landscape 16:9 source on a portrait-mounted iPad is cropped at the sides and then enlarged far harder than it needs to be. If the iPad is mounted portrait, make the OBS canvas portrait and set `config.capture` to match. This is free and it is worth more than any amount of sharpening.
- The operator panel shows what was asked for, what was captured, what is actually going out (`frameWidth`, `frameHeight`, fps, bitrate) and `qualityLimitationReason`, so a soft picture is diagnosed in seconds rather than guessed at. Offer creation on `request-offer`, ICE to viewers, cache semantics unchanged. Reports `feed-status` on track state changes. All live editing (scenes, effects, her mic mute) happens in OBS via her foot pedals; the page just consumes the virtual devices and must keep streaming seamlessly across OBS scene switches.
- **Answers the monitor feed**: accepts the iPad's return-feed offer, attaches incoming audio to an `<audio autoplay>` element. Output device: **earpiece only** (wired preferred), never Mac speakers (feedback with the iPad in the room). Reports `monitor-status` on track state changes.
- **Message stream**: incoming prompts appear as discrete finished items with timestamp and detected language; a soft tick plays into the earpiece when one lands, so she can keep her eyes off the screen while performing. Newest message is large; history is a quiet dimmed column, not a chat layout.
- **Monitor controls**: a single discreet level meter for incoming room audio and a mute-monitor toggle (mutes only her earpiece, changes nothing on the iPad).
- **Self-monitoring note**: her own voice returns acoustically from the iPad speaker into the iPad mic; AEC on the iPad removes most of it. If a residual delayed self-echo in her earpiece is distracting during rehearsal, add a simple monitor duck (attenuate the earpiece by 12 dB while her outgoing audio level is hot, measured with an AnalyserNode on her outgoing track). Build this only if rehearsal shows it is needed.
- Hidden operator panel on `Cmd+.`: `/health` data, device picker, viewer count, whisper status, log tail, restart-offer and clear-cache buttons. Never visible by default; the visible screen stays gallery-clean.

## 10b. Watching the iPad from the other room

The iPad is mounted, in another room, in Guided Access. It cannot be picked up and looked at,
and a surface that is connected is not necessarily a surface that is well.

**It reports on itself every three seconds** (`viewer-status`, viewer to server to controller):
frame rate, whether the render pass is running or has fallen back, the resolution actually
arriving, both peer connection states, the microphone's state, whether it is muted, whether the
wake lock is held, and which UI state it is in. `/health` carries the last report, and drops it
after fifteen seconds so a stale one can never be mistaken for a live one.

**Frame rate is the number that matters.** Everything else can read green while the surface runs
at eight frames a second because the render pass is thermally throttled, and from the other room
that is invisible. The rail shows it in one quiet line under the iPad row: `30 fps 1920x1080
idle` when it is well, and the specific fault in amber when it is not (`no render pass, 9.2 fps,
muted`). Full detail is in the operator panel.

**Reload the iPad** from the operator panel (`reload-viewer`, controller only: a viewer must not
be able to reload the others). The surface comes back on its own, because the microphone
permission persists across a reload and the sound choice is remembered, so the audio ritual does
not reappear in front of a visitor. This is the same path the watchdog already takes on its own
after `watchdogReloadMs`; this simply lets her take it deliberately.

## 11. UI design system (both pages share these tokens)

Aesthetic: soft spatial computing in a **light key**. Calm, precise, gallery-grade, and warm
rather than clinical. On the iPad, **her rendered face is the content and the interface defers
to it**: light around the edge of the screen, and one small capsule of glass. Nothing competes
with her, and nothing is ever laid on top of her.

**The field is neutral and the only colour on screen is her face.** An earlier version tinted
every neutral with red, on the theory that a warm field reads as lit skin. It does the
opposite: the same blush lands on her skin, the glass, the type and the shadows, everything
converges on one pastel, and nothing looks sharp because nothing is any longer distinct from
anything else. Warm greys plus a rose accent is also the house style of every generated
product page in existence. Keep the field neutral and let her be the warm thing in it.

```css
--bg-0: #EBEAF2;            /* near-white with the faintest purple blue cast */
--bg-lift: #F8F7FD;         /* the lift under the centre of the field */
--tint-cool: #DEE1F1;       /* periwinkle, the cooler of two ambient washes */
--tint-warm: #E9E2F1;       /* pale lavender, the warmer one */
--glass-fill: rgba(255,255,255,0.66);
--glass-edge: rgba(255,255,255,0.94);   /* inset top highlight, the "material" tell */
--glass-line: rgba(0,0,0,0.08);         /* a true hairline */
--glass-blur: 30px;
--ink-hi: #1B1A24;          /* real density. A 92% warm brown never gets past mid grey. */
--ink-mid: #55525F;
--ink-lo: #8A8796;
--ok: #3E9B6D;              /* status dots only */
--warn: #B4703F;
--ai-1: #F2C766; --ai-2: #B486DC; --ai-3: #EE8CBA; --ai-4: #F3AE8E;  /* the edge light */
--ai-stops: var(--ai-1), var(--ai-2), var(--ai-3), var(--ai-4), var(--ai-1);
--shadow-soft: 0 0.5px 1px rgba(32,24,64,0.05), 0 3px 10px rgba(32,24,64,0.06);
--shadow-pane: 0 0.5px 1px rgba(32,24,64,0.06),
               0 6px 16px rgba(32,24,64,0.07),
               0 20px 48px rgba(32,24,64,0.08);
--font-display: -apple-system, "SF Pro Display", system-ui, sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace;
--radius-pane: 22px;
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-soft: cubic-bezier(0.32, 0.72, 0.24, 1);
--dur-fast: 180ms; --dur-med: 320ms;
```
- **Shadows are neutral black at low opacity, layered in three**: a half-pixel contact shadow,
  a form shadow, and a wide ambient one. That is how macOS builds elevation, and a coloured
  glow instead of a contact shadow is what makes a panel look like a web page.
- **Hierarchy comes from weight and value, never from colour.** No coloured "AI" in the
  wordmark, no tinted meter. The single exception is the edge light (11a), which is not
  decoration but the state of the machine.
- **Grain**: a faint SVG `feTurbulence` overlay (about 3%, `multiply`) on both pages. Large soft
  gradients in a light key band badly on an 8 bit panel; this fixes that and gives the surface
  a material at the same time.
- **iPad layout**: the rendered presence fills the screen, a neutral field drifts slowly behind
  it (70 s), and one small glass capsule sits low with the hint line. Transcripts
  render inside the pane in display type. The glass refracts her, which is what makes the
  material read as real. The pane lifts its shadow while a visitor is holding it.
- **Exactly one thing fades her, once.** The dissolve lives in the shader's alpha channel and
  nowhere else. A CSS vignette, a mask on the element and a light wrap in the shader will each
  look reasonable alone and stack into a ghost, which is precisely what happened: three washes
  over the same face, on a white ground, until she had no density left at all.
- **There is no orb.** See 11a.
- **Controller layout**: the same field with two blurred ambient washes (`filter: blur(90px)`,
  60 s drift), a small self-preview of the outgoing feed, the message column in glass, and a
  neutral monitor meter.
- **Glass pane**: `backdrop-filter: blur(var(--glass-blur)) saturate(150%)` **plus the `-webkit-` prefix** (Safari renders a flat box without it), fill `--glass-fill`, 1 px `--glass-line`, `border-radius: var(--radius-pane)`, `box-shadow: var(--shadow-pane), inset 0 1px 0 var(--glass-edge)`, `will-change: transform`. That inset top highlight is what reads as a lit edge rather than a border. Backdrop-filter on this one element only per page.
- **Type**: display copy in `--font-display` at **weight 400**, tracking -0.024em. Not 300: a hairline weight at display size on a bright ground has no edge to it, greys out, and reads as soft rather than precise. Secondary 13 px at `--ink-lo`.
- **Micro labels are set in `--font-mono`**, uppercase, 10 px, 0.1em tracking: the status pill, the footer, the operator panel. SF Mono is what a Mac uses when it is being an instrument rather than an app. It gives the surface a specific character without shipping a typeface the gallery machine might not have, and it is the cheapest way to stop this looking like every other soft-cornered assistant.
- **Motion**: transform/opacity only; enter/exit with `--ease-spring` at `--dur-med`; ambient loops linear and slow. Focus states brighten the glass and add soft glow; keep a visible `:focus-visible` treatment on the controller.
- **Forbidden**: chat bubbles, avatars, sparkles or star icons, saturated purple/blue AI gradients, message-app typing indicators, spinners, grey or black shadows, pure white surfaces, more than one accent color on screen.

## 11a. The edge light (the interface)

Apple retired the Siri orb in favour of a glowing screen border, and the same move is right
here for a reason specific to this piece: **an orb has to sit somewhere, and anywhere it sits
is on top of her.** Every attempt to place it produced the same bug in a new position, most
recently a white dot resting on her chin in landscape. Light around the edge of the world costs
her nothing at all, and it removes that entire class of problem permanently.

- A conic gradient turning slowly around the screen border: a 1.5 px hairline of colour exactly
  on the edge, plus a blurred copy of the same ring falling inward as its glow. The blur belongs
  on a wrapper, not the masked element: applied to the masked element it is clipped and leaves a
  hard inner edge.
- Yellow, purple and pink, with one warm step carrying pink back round to yellow so the loop has
  no seam at the wrap. Held far down in saturation, so it reads as prismatic light rather than
  a rainbow: a literal rainbow border would look borrowed. Defined once as `--ai-stops` and
  reused by the edge, the button rim and the send sweep, so the three can never drift apart.
- `idle` turns slowly and sits low. Holding quickens it and opens the bloom, and its brightness
  tracks her voice through `--glow`. That is the level meter now, and it is information rather
  than decoration, which is why it is the one exception to the no-colour rule.
- `@property --ai-angle` drives the rotation. Where it is unsupported the edge is static and
  prismatic instead of turning; nothing depends on the motion.
- **The whole screen is the button.** With no pane to aim at there is nothing to find, which is
  the correct affordance for a visitor who has been given no instructions. Only leaving the
  screen entirely cancels a held message, so a thumb sliding about mid sentence does not lose it.

**The three light events.** Each one answers a question the visitor is actually asking, and
there is nothing else in the system that can answer them.

1. **Heard you.** The instant the 250 ms hold takes, the whole edge flares once. It fires at the
   exact moment recording begins, so the flash *is* the record light rather than a decoration
   near it.
2. **Still hearing you.** Handled live by `--glow`, which is her voice through the analyser.
   Nothing scripted, so it cannot lie about whether the microphone is working.
3. **It went.** On release a bright band travels once all the way round the border and goes out.
   A pulse would say "something happened"; a full lap of the screen says "it left", which is the
   thing they need to know. The button also compresses under the press, which lands before any
   light does.

**There is no haptic option, and this is hardware, not code.** iPads have no Taptic Engine: only
the Apple Pencil Pro and the M4 iPad Pro's Magic Keyboard trackpad have haptics, never the
tablet body. `navigator.vibrate` has never been implemented in iOS Safari, and the hidden
checkbox-switch trick that produced haptics from JavaScript between iOS 17.4 and 26.4 was
patched out in 26.5. Do not spend time on it again. Light is the only confirmation channel this
device has, which is why the three events above have to carry the whole job.

**The button cannot be allowed to lock up.** A pointerup that never arrives (a finger dragged
off the edge of the glass, a pointer lost to the system) used to leave the pointer id set, after
which every later press returned early and did nothing: the control was dead until the page
reloaded, and in a gallery nobody reloads it. A stale id is now simply cleared on the next
press, and losing focus or visibility ends the hold cleanly.

**The button is a disc with the instruction set around its own rim**, English arcing over the
top and German under the bottom on a counter-rotated path so it reads upright. Round because the
thing it does is round: hold, speak, release, back to where you started. Curving the words with
the edge makes the control one object rather than a label sitting on a shape, and it lets both
languages sit at the same weight instead of one being the small print. Its centre carries the
only level indicator left in the system, which matters because that indicator now lives inside
the control instead of anywhere near her face. It is also the piece of glass the render pass
refracts (9b).

## 11b. Register: the Fat Car

The surface is an Apple Intelligence interface that ate too much.

The reference is Erwin Wurm's Fat Car: take a sleek premium object, keep it perfectly
recognisable, and inflate it past what good taste allows. That is the correct register for a
piece whose entire subject is the fiction of an AI product. Nothing here is redesigned into
something strange. Everything is simply **too much**, and the joke only lands because it is
still obviously an Apple product underneath. A restrained version of this interface would be a
worse artwork, because a convincing imitation says nothing and a bloated one says exactly what
Nickii is doing.

In practice:

- **The judder is gone, and should stay gone.** The surface used to take a damped shock on
  send, standing in for the vibration the iPad cannot do. In practice it read as a glitch
  rather than as a knock: nothing on a screen has the mass to sell an impact, so it looked
  broken instead of physical. It also resampled the rendered canvas on every frame it ran,
  costing exactly the sharpness the render pass exists to produce. `#stage` remains as a plain
  untransformed wrapper. **Confirmation is light, and light only.**
- **The swell.** Pressed, the button distends instead of compressing, overshoots well past its
  mark and wobbles back. A sleek control sinks; a fat one bulges.
- **The bloom.** The edge light is far thicker and far brighter than any real product would
  ship, and it fattens further with her voice.

**The limit, and it is a hard one.** Her face is the content. When the glow floods far enough
inward to bleach her out, the piece has stopped working, and no amount of excess is worth that.
The bloom is inflated right up to the point where she is still unmistakably present and no
further. If the light and her face ever compete, her face wins.

**She holds still.** The presence drifts on a 26 second cycle at well under one percent, and
the field behind her on two minutes at barely more. Neither should ever be caught moving; the
light should simply seem to have changed when you look again. Motion you can actually see
reads as a video sliding about, which is the one thing the render pass exists to prevent. The
excess belongs in the light, never in the picture.

**The pause after a message.** Released, the surface locks: transcribed, shown, lifted, and
only then ready again, about five seconds in total. The button dims and its centre breathes,
deliberately not a spinner. Two reasons. A visitor pressing again immediately would talk over
an answer they cannot know is coming, and more importantly the pause is Nickii's: it is the
window in which she actually replies. A watchdog releases the lock after 25 seconds so a
whisper that never answers cannot strand the installation held shut, and a transcript arriving
while someone is already holding releases it too.

`prefers-reduced-motion` disables the register: no swell, no rotation, nothing moving. The
whole Fat Car reading is carried by motion, and that is the one visitor for whom it is not a
joke.

## 11c. Running cool for six hours

A fanless iPad runs this all day with the WebGL pass, several full screen composited layers and
a permanent WebRTC connection. Everything here is a decision about heat, not about taste.

- **The edge light rotates a static gradient, it does not animate a gradient.** Animating a
  conic's own angle repaints the layer every frame; rotating a pre-rendered one is a GPU
  transform and costs nothing. It also drops the `@property` dependency, so the light turns on
  in every Safari rather than only the ones that register custom angle properties.
- **The bloom turns in steps, the ring turns smoothly.** The bloom sits behind a 44 px full
  screen blur, so a smooth rotation forces that blur to re-render every frame in order to
  produce motion the blur itself destroys. Ninety steps over 22 s is one re-render every quarter
  second and is completely invisible at that radius. The crisp ring keeps a smooth rotation,
  because there the motion is the whole point.
- **The level analyser only runs while someone is holding.** Idle is the state this installation
  spends almost all of its life in, and the level is only read during a hold. Measuring anyway
  meant a 2048 sample sum sixty times a second, for six hours, to write a zero.
- **Nothing accumulates.** The controller's message history is capped, the server's cached ICE
  list is capped, and the audio graph disconnects its old source before making a new one. In a
  six hour unattended run, "bounded in practice" is not a good enough reason to leave a list
  unbounded.
- **The drawing buffer renders at the panel's real pixels** and `render.maxPixels` is the
  thermal valve, not a quality setting. Lowering it costs sharpness directly (9b).

If the iPad ever runs hot in rehearsal, the order to reduce is: `render.maxPixels`, then the
bloom blur radius, then `capture.maxBitrate`. Her picture is the last thing to give up.

## 11d. Loop, response, takeover

The MacBook cannot stand in the gallery all day. The installation therefore runs on its own and
she takes it over for about an hour when she performs.

**Four states.** All four pass through the same render pass (9b), so they are visually
indistinguishable and every transition is a cross-fade rather than a cut.

1. **calm** — a 30 minute sequence, looping, with sound. The default, indefinitely.
2. **response** — a visitor holds the button and speaks. On release the calm loop fades into one
   of several 5 minute sequences, chosen in rotation. When it ends it fades back to calm.
3. **live** — she logs in from the MacBook and takes over. Exactly the system in sections 9 and
   10: her live face and voice, room audio in her earpiece, push to talk, real transcripts.
4. **handback** — the controller leaves and the iPad returns to calm on its own.

**Several response sequences, never one.** A visitor who presses twice, or watches someone else
press, sees the same film restart and the illusion is gone. With four the machine appears to be
choosing.

**The videos are shot plain and styled on the device.** Head and shoulders, even light, plain
background, the same framing as the live performance. No baked-in look: the render pass applies
it live, which is what makes calm, response and live indistinguishable, and means retuning
`config.render` later moves all of them together.

**Sound is the hard constraint.** All the sequences have sound, and iOS will not play unmuted
video without a user gesture. Unattended there is nobody to give one. The escape is that WebKit
permits unmuted playback while the page is capturing, so **the iPad holds the microphone open
during the loop**. It needs it for the button in any case. Nothing is transmitted or recorded
while no controller is connected, and section 2 rule 10 still governs disclosure.

**Audio cross-fades with the picture.** Handing over to her live voice must not cut the loop
off, and handing back must not drop into silence.

## 11e. The hardware, and why the Pi is the installation

| | role | when |
| --- | --- | --- |
| Raspberry Pi 4 | access point, server, video store | always on |
| iPad | the visitor surface | always on |
| MacBook Pro | OBS, whisper, the controller | only during the live hour |
| Raspberry Pi 3 | identical spare card, swapped in if the 4 dies | in the bag |

**Eduroam, and any other institutional network, is unusable for the device link.** They isolate
their clients: the iPad and the Mac can be on the same Wi-Fi and have no route to each other,
everything reads healthy, and `viewerCount` sits at 0 forever (4b). The Pi runs `hostapd` and
makes its own network, which is also the only network the exhibition iPad ever knows.

**Whisper stays on the MacBook.** A Pi cannot run `large-v3-turbo` usefully, and it is only
needed while she is live. During calm and response nothing is transcribed: the button changes
the video, no text is involved.

**The bandwidth to watch is the live hour only.** Her feed crosses the Pi's Wi-Fi at around
12 Mbit. Calm and response come off the Pi's own disk and are unaffected. If the link is tight,
in order: run Ethernet from the MacBook to the Pi so only the iPad is wireless, add a USB Wi-Fi
dongle to the Pi, or drop `capture.maxBitrate`.

**The controller needs a password.** Today anyone who opens `/control` becomes the controller.
On a permanent network in a public building that is not acceptable.

## 12. Reliability engineering

- **Keep everything alive**: `com.nickii.ai.plist` LaunchAgent (`KeepAlive`, `RunAtLoad`) for `node server.js`; the same pattern supervises `start-whisper.sh`. Both self-restart after crash or reboot. OBS itself is started manually as part of the show runbook (it is a performance instrument, not a daemon).
- **Mac show settings**: `caffeinate -dims` from the LaunchAgent; automatic updates and notifications off (Focus mode); audio output locked to the earpiece; camera/mic exclusivity checked (nothing else may grab OBS Virtual Camera or BlackHole).
- **iPad hardening**: Guided Access, Auto-Lock Never, fixed brightness, other networks forgotten, "Hey Siri" off, mic permission granted before locking, powered mount.
- **Self-healing chain**: server ping/pong culls dead sockets; client heartbeat catches half-open sockets; backoff reconnect; cached-offer replay; both peer connections auto-renegotiate on reconnect; frame watchdog escalates ICE restart then reload. Acceptance bar: kill Wi-Fi for 30 seconds mid-show and everything (her feed, monitor audio, messaging) recovers with zero human touches.

## 13. Build phases and acceptance tests

**Phase 1: network + HTTPS foundation.**
Pass when: iPad on `NICKII` opens **`https://nickii.ai`** with no warning and no port or IP anywhere in the address; mic permission persists across Home Screen relaunch.

**Phase 2: port the working signaling + outgoing A/V feed.**
Pass when: iPad shows her live video with audible live voice (unmuted autoplay confirmed after the one-time setup tap); OBS Virtual Camera + BlackHole are picked up by label; pedal-driven OBS scene switches never interrupt the stream; iPad reload reconnects in under 3 s via the cache; 30 s Wi-Fi kill recovers unattended.

Also pass when the operator panel's Picture block reads back the resolution that was asked for, on all three lines (asked for, captured, sending), and `limited by` stays `none` through a full scene-switch pass. Anything less than the OBS canvas on the "sending" line means the encoder is shrinking her, and no work on the iPad will fix it. This check exists because the first build of this system captured at 640x480 without anyone noticing: the picture merely looked disappointing, which is exactly how this failure presents.

**Phase 2b: the render.**
Pass when: on the exhibition iPad the render pass holds a steady frame rate for an hour with no thermal throttling and no rise in battery temperature that the mount cannot handle; her face reads as lit into the surface rather than pasted onto it; the sharpening does not visibly lift camera noise at her actual OBS exposure; and pulling the WebGL context (Safari Develop menu, or simply an unsupported device) falls back to the plain video with no black screen and no interruption to her voice.

**Phase 3: continuous monitor feed + PTT messages.**
Pass when: she hears the room in the earpiece with natural-response latency (target under 300 ms; host-candidate WebRTC on LAN is typically far under that); the feed survives reconnects and the post-reload capture sequence works without a tap (or the "touch to wake" fallback is in place); 20 spoken prompts (10 EN, 10 DE, ambient noise present) transcribe correctly in under 2.5 s from release; 10 minutes of loud ambience with no hold produces zero messages.

**Phase 4: full duplex integrity.**
Pass when: with her speaking live through the iPad while a visitor holds PTT, the transcript contains the visitor, not her (AEC verified); her earpiece has no distracting self-echo (add the monitor duck only if rehearsal demands it); A/V sync on her feed is natural.

**Phase 5: UI.**
Pass when: a first-time visitor completes hold, speak, send, and receives her live spoken answer within one minute with no verbal instructions; reduced-motion path verified.

**Phase 6: endurance + rehearsal.**
Pass when: 6 hour unattended run with periodic interactions and zero manual interventions; cold boot of both devices plus OBS to fully running in under 5 minutes by runbook.

## 14. Exhibition day runbook (print this)

1. Power both devices. Internet Sharing on, `NICKII` visible. LaunchAgents already run server + whisper.
2. **The address, neither piece survives a reboot:**
   `sudo node scripts/dns.js` (leave it running) and `sudo ./scripts/setup-port443.sh`.
   Then check `https://nickii.ai/health`.
3. Start OBS: correct scene collection, Virtual Camera started, audio monitoring to BlackHole, foot pedals responding (test one scene switch and one mic mute).
4. Open `https://nickii.ai/control`, confirm devices matched ("OBS Virtual Camera" + "BlackHole"), earpiece in, output device confirmed, monitor level test (someone speaks near the iPad).
5. iPad: joined `NICKII`, DNS still set to the Mac, Home Screen app launched, one-time setup tap done, her face and voice live, one PTT test message in each language.
6. Enter Guided Access. Mount and cable everything. Take position.
7. Unrecoverable failure ladder: (a) reboot iPad, relaunch app; (b) restart OBS + Virtual Camera; (c) reboot Mac, LaunchAgents self-start, rerun the two address commands, restart OBS; (d) travel router; (e) Render mode.

## 15. Guardrails for the implementing AI

- No frameworks, bundlers, TypeScript, or external services. Vanilla only.
- Do not rename or restructure existing signaling message types; extend them. The `return-feed-*` types are the monitor feed's signaling; keep their routing semantics.
- No STUN/TURN or internet-dependent paths in `local` mode.
- **No TTS, no speech synthesis, no generated replies, no reply composer.** The only voice in this system belongs to Nickii, live.
- Whisper must never receive audio outside a PTT session. The continuous stream goes to the human ear only.
- Neither the monitor feed nor the outgoing A/V is ever recorded, buffered to disk, or logged in any form.
- The render pass finishes her picture; it does not grade it. Colour is OBS and her pedals. If a change would be better made with a foot pedal, make it there.
- The render pass must always be able to fail. Any path that leaves the visitor with a black screen instead of her face is wrong, however good it looks when it works.
- The visitor never sees an IP address or a port. If a change would put one on screen, it is wrong.
- No em dashes in any user-facing copy or documentation; use commas, periods, or parentheses.
- Visitor-facing copy: sentence case, plain, bilingual EN with a smaller DE line, no exclamation marks, no "AI assistant" language.
- When in doubt, the acceptance tests in section 13 define "done".
