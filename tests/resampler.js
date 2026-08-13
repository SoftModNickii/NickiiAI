// The capture worklet, run outside a browser.
//
//   node tests/resampler.js
//
// Whisper is fed 16 kHz mono PCM resampled from the iPad's 48 kHz context. If
// the resampler drifts, every transcript is subtly pitch shifted and accuracy
// falls without anything visibly breaking. An early version emitted 0.8% too
// many samples because the read position resynced at each block boundary.

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public/worklet-capture.js'), 'utf8');

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   (${detail})` : ''}`);
  if (!ok) failures++;
};

class AudioWorkletProcessor {
  constructor() { this.port = { postMessage: (buf) => this._onPost(buf) }; }
}

function build(contextRate) {
  let Processor = null;
  new Function('AudioWorkletProcessor', 'sampleRate', 'registerProcessor', src)(
    AudioWorkletProcessor, contextRate, (name, cls) => { Processor = cls; });
  const p = new Processor({ processorOptions: { targetRate: 16000 } });
  const out = [];
  p._onPost = (buf) => out.push(...new Int16Array(buf));
  return { p, out };
}

function run(contextRate, freq = 1000, blocks = null) {
  const BLOCK = 128;
  const n = blocks === null ? Math.floor(contextRate / BLOCK) : blocks;
  const { p, out } = build(contextRate);
  let i = 0;
  for (let b = 0; b < n; b++) {
    const ch = new Float32Array(BLOCK);
    for (let k = 0; k < BLOCK; k++, i++) ch[k] = 0.8 * Math.sin(2 * Math.PI * freq * i / contextRate);
    p.process([[ch]]);
  }
  p.flush();
  return { out, inputSamples: n * BLOCK };
}

console.log('\nCapture worklet\n');

for (const rate of [48000, 44100]) {
  const { out, inputSamples } = run(rate);
  const expected = Math.round(inputSamples * 16000 / rate);
  check(`${rate} Hz source resamples to 16 kHz`, Math.abs(out.length - expected) <= 1,
    `${out.length} samples, expected ${expected}`);

  let crossings = 0;
  for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++;
  const expectedHz = 1000 * inputSamples / rate;
  check(`${rate} Hz preserves pitch`, Math.abs(crossings - expectedHz) <= 2,
    `${crossings} cycles, expected ~${Math.round(expectedHz)}`);

  let peak = 0, maxStep = 0;
  for (let i = 0; i < out.length; i++) {
    peak = Math.max(peak, Math.abs(out[i]));
    if (i) maxStep = Math.max(maxStep, Math.abs(out[i] - out[i - 1]));
  }
  check(`${rate} Hz preserves amplitude`, Math.abs(peak - 0.8 * 32767) / (0.8 * 32767) < 0.02,
    `peak ${peak}`);

  // A dropped or duplicated sample at a block boundary shows up as a step
  // larger than the waveform itself can take between two samples.
  const theoretical = Math.sin(2 * Math.PI * 1000 / 16000) * 0.8 * 32767;
  check(`${rate} Hz has no discontinuity at block boundaries`, maxStep <= theoretical * 1.05,
    `max step ${Math.round(maxStep)} vs ${Math.round(theoretical)}`);
}

console.log(failures === 0 ? '\nResampler is sample exact.\n' : `\n${failures} failed.\n`);
process.exit(failures ? 1 : 0);
