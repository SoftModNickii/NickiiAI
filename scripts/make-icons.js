// Generates the app icons: the button, as a mark. A prismatic ring around a
// pale disc on the same field the app uses, so the Desktop launcher, the Dock
// and the iPad Home Screen all carry one identity.
//
// Written with zlib only, so the repo keeps its no-dependency rule.
// Run: node scripts/make-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// The palette, matching :root in client.html.
const FIELD = [0xeb, 0xea, 0xf2];   // --bg-0
const LIFT  = [0xf8, 0xf7, 0xfd];   // --bg-lift
const GLASS = [0xfd, 0xfd, 0xff];   // the disc
const STOPS = [                     // --ai-stops, yellow, purple, pink, bridge
  [0xf2, 0xc7, 0x66],
  [0xb4, 0x86, 0xdc],
  [0xee, 0x8c, 0xba],
  [0xf3, 0xae, 0x8e],
];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Smooth coverage across one pixel, so nothing needs supersampling to look clean.
const band = (v, edge, soft) => clamp01((edge - v) / soft + 0.5);

// The conic sweep, wrapping seamlessly back to the first stop.
function conic(angle) {
  const n = STOPS.length;
  const p = ((angle / (Math.PI * 2)) % 1 + 1) % 1 * n;
  const i = Math.floor(p);
  const t = p - i;
  const a = STOPS[i % n];
  const b = STOPS[(i + 1) % n];
  // Smoothstep between stops keeps the wheel from showing four hard spokes.
  const s = t * t * (3 - 2 * t);
  return [mix(a[0], b[0], s), mix(a[1], b[1], s), mix(a[2], b[2], s)];
}

function png(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const cx = size / 2;
  const cy = size / 2;

  const rDisc  = size * 0.300;   // the glass
  const rRingI = size * 0.316;   // the prismatic rim
  const rRingO = size * 0.352;
  const rGlow  = size * 0.470;   // its light, falling outward
  const soft   = Math.max(1, size / 180);

  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;                                   // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ring = conic(Math.atan2(dy, dx) + Math.PI * 0.75);

      // The field, lifted a little at the centre so it is never flat.
      const lift = clamp01(1 - d / (size * 0.62));
      const base = [0, 1, 2].map((c) => mix(FIELD[c], LIFT[c], lift * 0.85));

      // The ring's glow, outside the rim only.
      const glow = clamp01(1 - (d - rRingO) / (rGlow - rRingO)) * (d > rRingO ? 1 : 0);
      const withGlow = [0, 1, 2].map((c) => mix(base[c], ring[c], glow * glow * 0.42));

      // The rim itself.
      const rim = band(d, rRingO, soft) * (1 - band(d, rRingI, soft));
      const withRim = [0, 1, 2].map((c) => mix(withGlow[c], ring[c], rim));

      // The disc, with a lit top edge so it reads as a turned object.
      const disc = band(d, rDisc, soft);
      const sheen = clamp01(1 - (dy + rDisc * 0.55) / (rDisc * 1.5));
      const glass = [0, 1, 2].map((c) => Math.min(255, GLASS[c] + sheen * 6));
      const out = [0, 1, 2].map((c) => mix(withRim[c], glass[c], disc));

      raw[p++] = Math.round(clamp01(out[0] / 255) * 255);
      raw[p++] = Math.round(clamp01(out[1] / 255) * 255);
      raw[p++] = Math.round(clamp01(out[2] / 255) * 255);
      raw[p++] = 255;                               // opaque: iOS composites on black
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[
  ['apple-touch-icon.png', 180],   // iPad Home Screen
  ['icon-192.png', 192],
  ['icon-512.png', 512],           // also the source for the Desktop .icns
].forEach(([name, size]) => {
  fs.writeFileSync(path.join(outDir, name), png(size));
  console.log('wrote', path.join('public', 'icons', name), size + 'px');
});
