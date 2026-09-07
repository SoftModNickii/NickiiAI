// Runtime test for both surfaces.
//
//   node tests/pages.js             (needs the server running)
//
// Loads each page in a real browser and asserts it runs clean: no uncaught
// errors, no rejected promises, no undefined CSS variables, and the pieces
// each page depends on actually present.
//
// The controller in particular had no runtime coverage at all. It is the
// surface Nickii looks at for six hours, and a JavaScript error there is
// invisible until something she needs has quietly stopped working.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const PORT = process.env.NICKII_PORT || 8443;
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
  if (!ok) failures++;
};

// Runs in the page. Reports what actually happened rather than what should have.
const REPORT = `
window.__err = [];
window.addEventListener('error', function (e) { window.__err.push(e.message); });
window.addEventListener('unhandledrejection', function (e) {
  window.__err.push('promise: ' + ((e.reason && e.reason.message) || e.reason));
});
window.__report = function (want) {
  var missing = want.filter(function (sel) { return !document.querySelector(sel); });
  // Any custom property that resolves to nothing is a rule that silently did
  // not apply. An unbalanced brace once voided an entire stylesheet this way.
  var css = getComputedStyle(document.documentElement);
  var unresolved = [];
  ['--ink-hi', '--bg-0', '--font-display'].forEach(function (v) {
    if (!css.getPropertyValue(v).trim()) unresolved.push(v);
  });
  return {
    errors: window.__err,
    missing: missing,
    unresolved: unresolved,
    // FontFaceSet is set-like, not array-like: it has forEach but no index.
    fontLoaded: (function () {
      var found = false;
      document.fonts.forEach(function (f) {
        if (f.family === 'Archivo' && f.status === 'loaded') found = true;
      });
      return found;
    })(),
    bodyFont: css.getPropertyValue('--font-display').trim(),
  };
};`;

function load(page, want, settleMs) {
  const src = fs.readFileSync(path.join(REPO, 'public', page), 'utf8');
  const html = src
    .replace('</head>', `<script>${REPORT}</script></head>`)
    .replace('</body>', `<script>
      // Wait for the font to actually resolve rather than racing it.
      document.fonts.ready.then(function () {
        setTimeout(function () {
          document.title = 'R' + JSON.stringify(window.__report(${JSON.stringify(want)}));
        }, ${settleMs});
      });
    </script></body>`);

  const tmp = path.join(REPO, 'public', '_pages_probe.html');
  fs.writeFileSync(tmp, html);
  try {
    const dom = execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--ignore-certificate-errors',
      '--dump-dom', `--virtual-time-budget=${settleMs + 2500}`,
      '--window-size=1366,1024',
      `https://127.0.0.1:${PORT}/_pages_probe.html`,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
    const m = /<title>R(.*?)<\/title>/s.exec(dom);
    if (!m) throw new Error('page never reported');
    return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  } finally {
    fs.unlinkSync(tmp);
  }
}

console.log('\nPage runtime\n');

const SURFACES = [
  {
    file: 'client.html',
    name: 'visitor surface',
    // Everything the piece cannot run without.
    want: ['#presence', '#feed', '#render', '#edge', '#pane', '#pane .ring',
           '#pane .arc', '#invite', '#said',
           '#ops', '#ops-hot', '#masthead', '#footer', '#stage'],
  },
  {
    file: 'control.html',
    name: 'controller',
    want: ['#preview', '#stream', '#latest', '#history', '#meter', '#mute',
           '#earpiece', '#pull', '#op', '#op-picture', '#op-health', '#op-log',
           '#op-vid', '#op-aud', '#op-out', '#d-link', '#d-feed', '#d-mon'],
  },
];

for (const s of SURFACES) {
  let r;
  try { r = load(s.file, s.want, 1400); }
  catch (e) { check(`${s.name} loads`, false, e.message); continue; }

  // getUserMedia is denied in headless, and both pages are built to survive
  // that: it is the same path as an iPad with the microphone not yet granted.
  const real = r.errors.filter((e) => !/NotAllowedError|Permission|getUserMedia|not allowed/i.test(e));

  check(`${s.name} runs without errors`, real.length === 0, real.slice(0, 2).join(' | '));
  check(`${s.name} has every element it needs`, r.missing.length === 0, r.missing.join(', '));
  check(`${s.name} stylesheet applied`, r.unresolved.length === 0,
    r.unresolved.length ? `${r.unresolved.join(', ')} resolved to nothing` : '');
  check(`${s.name} uses Archivo`, /Archivo/.test(r.bodyFont), r.bodyFont);
  check(`${s.name} loaded the self-hosted font`, r.fontLoaded === true);
}

// Two decisions that are invisible when broken: the page still looks right,
// it just runs hot. Section 11b explains both.
const client = fs.readFileSync(path.join(REPO, 'public/client.html'), 'utf8');
check('the bloom steps rather than re-blurring every frame',
  /#edge \.bloom > i \{ animation-timing-function: steps\(/.test(client));
check('the level analyser is idle unless someone is holding',
  /if \(!holding\) \{[\s\S]{0,200}return;/.test(client));

// Sound is the piece, not a setting. There is no control to turn it off and
// nothing persisted that could outlive the visitor who set it: an installation
// that came up silent on Tuesday because somebody muted it on Monday is not a
// quieter version of this work, it is a broken one.
check('nothing on the glass can mute her',
  !/sound-off|muted-choice|nickii-muted/.test(client));
check('and no mute preference is ever stored',
  !/localStorage[\s\S]{0,40}muted/.test(client));
check('but a refusal still leaves a picture, and keeps asking',
  /function wantSound/.test(client) && /setInterval\([\s\S]{0,160}wantSound/.test(client));

console.log(failures === 0 ? '\nBoth surfaces run clean.\n' : `\n${failures} failed.\n`);
process.exit(failures ? 1 : 0);
