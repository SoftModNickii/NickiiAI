// NICKII AI, single source of configuration.
// Section 7 of NICKIIAI.md. Both server and clients read from here:
// the browser gets the client relevant subset from GET /config.json.

// render.yaml stays unchanged, so the cloud fallback is detected rather than
// configured: Render sets RENDER in the environment. NICKII_MODE always wins.
const detected = (process.env.RENDER || process.env.RENDER_EXTERNAL_URL) ? 'render' : 'local';

module.exports = {
  mode: process.env.NICKII_MODE || detected,   // 'local' | 'render'

  // Overridable so a test run can stand up its own instance beside the live
  // one instead of taking the show's server and whisper down to run.
  httpsPort: Number(process.env.NICKII_PORT) || 8443,
  certPath: './certs/nickii.local.pem',
  keyPath: './certs/nickii.local-key.pem',

  whisperUrl: process.env.NICKII_WHISPER_URL || 'http://127.0.0.1:8178/inference',
  // Whisper runs on her MacBook, always: the Pi cannot run large-v3-turbo
  // usefully, and it is only needed while she is live anyway. But the server
  // moved to the Pi, so loopback no longer reaches it. Rather than pinning the
  // Mac's address, which DHCP and a private Wi-Fi address both change, the
  // server follows the controller: the machine holding the controller socket
  // IS the MacBook, and it is connected exactly when transcription is wanted.
  // An explicit NICKII_WHISPER_URL always wins.
  whisperFollowsController: !process.env.NICKII_WHISPER_URL,
  whisperLang: 'auto',
  whisperTimeoutMs: 20000,

  preferredDevices: {                          // matched by label substring in the controller
    video: 'OBS Virtual Camera',
    audio: 'BlackHole',
  },

  // What the controller asks OBS Virtual Camera for. Without these the browser
  // hands back its default, which is 640x480, and the iPad then upscales that
  // three or four times to fill the screen. That is the whole cause of a soft,
  // pixelated picture, and no amount of sharpening recovers detail that was
  // never captured.
  //
  // Set these to match the OBS canvas. If the iPad is mounted in portrait,
  // make the OBS canvas portrait too: a landscape source on a portrait screen
  // is cropped at the sides and then upscaled far harder than it needs to be.
  // Portrait, because the iPad is mounted portrait and everything is shot for
  // it. The OBS canvas has to be 1080x1920 as well: a landscape source on a
  // portrait screen is cropped at the sides and then upscaled far harder than
  // it needs to be, and her live feed would not match the sequences.
  capture: {
    width: 1080,
    height: 1920,
    frameRate: 30,
    maxBitrate: 12000000,   // a private LAN with no uplink, so spend it on picture
  },

  // The render pass on the iPad. Colour grading still belongs to OBS and her
  // pedals; this is the finish that makes her read as rendered rather than
  // streamed. Tune during rehearsal, no shader edits needed.
  render: {
    sharpen: 0.28,     // 1 px crispness. Too much and camera noise comes up with it.
    clarity: 0.40,     // wide radius local contrast, the part that reads as "rendered"
    bloom: 0.40,       // how much the highlights spill light
    lightWrap: 0.50,   // how far the field's light falls onto her edges
    saturation: 0.90,  // 1.0 leaves her colour alone
    contrast: 1.12,    // density. On a bright field a face needs it or it reads as a ghost.
    // Where she sits in the frame and how tightly the dissolve crops to her.
    // Both radii are in units of screen HEIGHT, so the oval stays head shaped
    // whichever way the iPad is mounted. Dial these against her real OBS
    // framing: faceY down moves her down, the radii smaller crop in tighter
    // and hide more of the room.
    // ovalHeight covers head AND shoulders, not just the head. Cropped to the
    // head the pane floats over empty field with nothing behind it, and the
    // glass has nothing to refract, which is most of what makes it look real.
    faceY: 0.38,
    ovalWidth: 0.40,
    ovalHeight: 0.50,
    // Liquid Glass. backdrop-filter only blurs what is behind the pane; real
    // glass also bends it. Inside a band at the rim the image is displaced
    // along the surface normal, with the colour channels displaced by slightly
    // different amounts, so her face refracts and fringes through the border
    // the way a convex edge does. Set enabled:false for a plain frosted pane.
    glass: { enabled: true, band: 26, lens: 15, chroma: 2.2 },

    bicubic: true,     // Catmull-Rom upsampling. Off is bilinear, cheaper and softer.
    maxPixels: 6000000 // drawing buffer ceiling. Lower it only if the iPad runs hot.
  },

  // The installation runs alone. calm loops indefinitely; holding the button
  // plays one response, in rotation, then returns to calm. Drop the files into
  // public/video/ and list them here. Section 11d.
  video: {
    dir: './public/video',
    calm: 'calm.mp4',
    // One so far. They play in rotation, so add the others here as they are
    // cut: a name listed with no file behind it is a visitor holding the
    // button and getting nothing.
    responses: ['response-1.mp4'],
    // Everything dissolves out through the field and reforms, rather than
    // cross-fading. It matches how she arrives at boot, and it means one
    // canvas and one shader pass instead of two.
    dissolveMs: 900,
    // The controller gone this long hands the surface back to calm on its own,
    // so she can simply shut the laptop and walk away.
    handbackAfterMs: 25000,
  },

  // Anyone who opens /control becomes the controller. On a permanent network in
  // a public building that is not acceptable. Override with NICKII_PASSWORD.
  controlPassword: process.env.NICKII_PASSWORD || 'nickii',

  maxUtteranceSeconds: 30,
  heartbeatServerMs: 25000,
  heartbeatClientMs: 20000,
  reconnect: { baseMs: 1000, maxMs: 30000, factor: 2, jitter: 0.1 },
  watchdogNoFeedMs: 15000,
  watchdogReloadMs: 45000,

  junkTranscripts: [
    'thank you.',
    'thanks for watching',
    'untertitel im auftrag des zdf',
    'vielen dank.',
    'untertitelung des zdf',
    'thank you for watching',
    'subtitles by the amara.org community',
    'you',
    'bye.',
    'so.',
    'danke.',
  ],
  minTranscriptChars: 2,

  logDir: './logs',
};
