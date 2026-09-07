// Layout collision test for the visitor surface.
//
//   node tests/layout.js            (needs the server running)
//
// Every visible fault in this interface so far has been the same fault: two
// things occupying the same place. The orb on her chin. The invitation on her
// chin. The invitation on the button. The transcript on the button in
// landscape, which shipped because a media query kept a hardcoded position
// after the button grew.
//
// Eyes miss these, especially in the orientation nobody happens to screenshot.
// This measures the real boxes in a real browser, in both orientations, in
// every state, and fails on any intersection. It also checks that nothing is
// laid over her face, which is a standing rule of the piece.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PORT = process.env.NICKII_PORT || 8443;
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// The states worth checking, as literal class lists. feed-live is only set
// once her picture is actually arriving, so boot and wake are listed without
// it: in those states there is no face on screen to be covered.
const STATES = [
  'boot',
  'wake',
  'arriving feed-live',
  'idle feed-live',
  'listening feed-live',
  'sent feed-live',
  'sent said feed-live',
];
const SIZES = [
  { name: 'landscape 1366x1024', w: 1366, h: 1024 },
  { name: 'portrait 1024x1366', w: 1024, h: 1366 },
];

// Pairs that may legitimately overlap, and why.
const ALLOWED = new Set([
  // The button is glass sitting over her lower edge on purpose: the render
  // pass refracts her through it, which is what makes the material read.
  '#pane|#presence',
  '#invite|#presence',
  '#said|#presence',
  '#masthead|#presence',
  '#footer|#presence',
]);

const MEASURE = `
window.__probe = function () {
  var ids = ['#masthead', '#pane', '#invite', '#said', '#footer'];
  var out = {};
  ids.forEach(function (sel) {
    var el = document.querySelector(sel);
    if (!el) { out[sel] = null; return; }
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    out[sel] = {
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      visible: cs.display !== 'none' && parseFloat(cs.opacity) > 0.05
    };
  });
  // Where her face actually is, from the same numbers the shader uses.
  out.__face = { faceY: 0.38, ovalW: 0.40, ovalH: 0.50,
                 vw: innerWidth, vh: innerHeight,
                 // Only meaningful once her picture is actually on screen.
                 live: document.body.classList.contains('feed-live') };
  return out;
};`;

function probe(state, size) {
  const src = fs.readFileSync(path.join(REPO, 'public/client.html'), 'utf8');
  // Transitions and animations must be off. Headless virtual time does not
  // advance them reliably, so a measurement taken while one is in flight
  // reports the state the element was leaving rather than the one it is in.
  // That is not a detail: it silently made every number here wrong once.
  const page = src
    .replace('</head>', `<script>${MEASURE}</script>
      <style>*, *::before, *::after {
        transition: none !important;
        animation: none !important;
      }</style></head>`)
    .replace('</body>', `<script>
      document.body.className = ${JSON.stringify(state)};
      // The page's own start() rejects without a microphone and calls
      // setState('wake'), so the class is reasserted just before measuring.
      // No requestAnimationFrame here: under virtual time it is not guaranteed
      // to fire, and the page then never reports at all.
      setTimeout(function () {
        document.body.className = ${JSON.stringify(state)};
        // Worst case: the button swells with her voice, so measure it loud.
        document.body.style.setProperty('--glow', '1');
        document.title = 'PROBE' + JSON.stringify(window.__probe());
      }, 600);
    </script></body>`);

  const tmp = path.join(REPO, 'public', '_layout_probe.html');
  fs.writeFileSync(tmp, page);
  try {
    const dom = execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--ignore-certificate-errors',
      '--dump-dom', '--virtual-time-budget=2500',
      `--window-size=${size.w},${size.h}`,
      `https://127.0.0.1:${PORT}/_layout_probe.html`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    const m = /<title>PROBE(.*?)<\/title>/s.exec(dom);
    if (!m) throw new Error('page did not report its layout');
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.unlinkSync(tmp);
  }
}

const intersect = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// The ellipse the shader draws her into, in screen pixels. Measured in units
// of screen HEIGHT on both axes, exactly as the shader does it.
function faceBox(f) {
  const cx = f.vw / 2, cy = f.faceY * f.vh;
  const rx = f.ovalW * f.vh, ry = f.ovalH * f.vh;
  // Her face proper, not the head-and-shoulders crop: the upper portion.
  return { x: cx - rx * 0.62, y: cy - ry * 0.55, w: rx * 1.24, h: ry * 0.95 };
}

let failures = 0;
const say = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); };

console.log('\nLayout collisions\n');
for (const size of SIZES) {
  for (const state of STATES) {
    let boxes;
    try { boxes = probe(state, size); }
    catch (e) { say(false, `${size.name} [${state}] could not be measured: ${e.message}`); continue; }

    const face = faceBox(boxes.__face);
    const live = Object.entries(boxes)
      .filter(([k, v]) => k !== '__face' && v && v.visible);

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const [an, a] = live[i], [bn, b] = live[j];
        if (ALLOWED.has(`${an}|${bn}`) || ALLOWED.has(`${bn}|${an}`)) continue;
        say(!intersect(a, b), `${size.name} [${state}] ${an} clear of ${bn}`);
      }
    }
    // Nothing is ever laid over her face. This is a rule of the piece, not a
    // preference: it is the fault the orb was removed for. Only checked where
    // there is a face to cover: in boot and wake she has not arrived.
    for (const [name, box] of (boxes.__face.live ? live : [])) {
      if (name === '#masthead' || name === '#footer') continue;   // corners, by design
      say(!intersect(box, face), `${size.name} [${state}] ${name} not on her face`);
    }
  }
}

console.log(failures === 0 ? '\nNo collisions.\n' : `\n${failures} collision(s).\n`);
process.exit(failures ? 1 : 0);
