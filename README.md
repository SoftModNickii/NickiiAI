# NICKII AI

A two device performance installation by Nickii Schamborski, for the Ars Electronica Campus
Exhibition (Linz, September 2026).

The visitor believes they are talking to an AI. In reality, Nickii is the AI, live.

**[NICKIIAI.md](NICKIIAI.md) is the specification and the single source of truth.** This file
is only the short operating summary.

---

## What runs where

**iPad, the visitor surface.** Her live face fills the screen, rendered on the device so it
reads as a machine's picture of a face rather than a video call, and her live voice comes out
of the speaker. A prismatic light runs the edge of the screen and is the whole interface. One
glass disc says *Hold to speak*. Her answer arrives as her own voice, whenever she chooses.

**MacBook, everything else.** It serves the app over local HTTPS, runs the signaling, runs
Whisper, and publishes her outgoing feed from OBS. She wears an earpiece and hears the room
continuously.

No internet dependency, and no speech synthesis anywhere. The only voice belongs to Nickii.

## The three channels

| Channel | Direction | Transport | Gated |
| --- | --- | --- | --- |
| Her face and voice | Mac to iPad | WebRTC video + audio, `webrtc-*` signaling | always on |
| Room audio (her earpiece) | iPad to Mac | WebRTC audio, `return-feed-*` signaling | always on, never recorded |
| Visitor messages | iPad to Mac | 16 kHz PCM over WSS, then Whisper | only while push to talk is held |

Whisper only ever receives push to talk audio. The continuous monitor stream goes to her ear
and nowhere else: never written to disk, buffered, or logged.

## Run it

Double-click **NICKII AI.app** on the Desktop. It starts whisper and the server, waits until
`/health` actually answers, prints what is and is not running, and opens the controller.

Build that launcher once with `./scripts/make-launcher.sh`. By hand:

```sh
./scripts/nickii.sh          # start, and open the controller
./scripts/nickii.sh status   # what is running, plus the health endpoint
./scripts/nickii.sh stop
```

- visitor surface: `https://nickii.ai/`
- controller: `https://nickii.ai/control`
- health: `https://nickii.ai/health`

The visitor must never see an IP, so `nickii.ai` resolves from `scripts/dns.js` and exists only
on this network. `nickii.local:8443` and the raw IP keep working as fallbacks; the certificate
covers all of them.

Full setup, including the network, the OBS and BlackHole chain, the launchd agents, the iPad
Home Screen app and Guided Access, is in [scripts/setup-network.md](scripts/setup-network.md).

Hidden operator panels: `Cmd+.` on the controller, and four taps in the top left corner on the
iPad. Both are read-only diagnostics.

## Tests

```sh
npm test
```

163 checks, no dependencies, roughly a minute. Four suites:

- `tests/resampler.js` runs the capture worklet outside a browser and proves the 16 kHz PCM fed
  to Whisper is sample exact at both 48 and 44.1 kHz.
- `tests/protocol.js` drives a controller and two viewers through the whole signaling contract
  against its own server on its own ports, so it never disturbs a rehearsal.
- `tests/pages.js` loads both surfaces in a real browser and asserts they run without errors,
  with every element present and the stylesheet actually applied.
- `tests/layout.js` measures real bounding boxes in both orientations, in every state, at full
  swell, and fails on any overlap. It also enforces that nothing is ever laid over her face.

These exist because the recurring faults in this project were exactly two kinds: things
overlapping, and stylesheets silently not applying. Both are invisible until someone looks at
the right screen in the right orientation.

## Files

```
server.js                   HTTPS + WSS + signaling + PTT ingest + whisper bridge
config.js                   single config, also served to the browser at /config.json
public/client.html          iPad visitor surface (HTML + CSS + JS + GLSL)
public/control.html         Nickii's controller surface
public/shared.js            socket, heartbeat, backoff reconnect, watchdog
public/worklet-capture.js   mic to 16 kHz mono Int16 PCM
public/fonts/               Archivo, self-hosted: the gallery has no uplink
scripts/nickii.sh           the launcher
scripts/dns.js              answers nickii.ai on the local network
scripts/setup-network.md    the full runbook
tests/                      npm test
```

## Cloud fallback

`render.yaml` is unchanged and stays as the last rung of the failure ladder. Render mode is
detected automatically from the environment (or forced with `NICKII_MODE=render`), which serves
plain HTTP behind Render's own TLS and re-enables STUN. Whisper is not available there, so the
message layer degrades to "try again" while her feed keeps working.
