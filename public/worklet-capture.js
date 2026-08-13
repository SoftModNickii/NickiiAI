// NICKII AI, capture worklet.
// Mic to 16 kHz mono Int16 PCM, resampled from the context rate (48 kHz on
// iPadOS) by linear interpolation with the fractional read position carried
// across process() blocks, so there is no click at the block boundary.
//
// The processor runs continuously. Gating is the main thread's job: chunks are
// only forwarded to the server between ptt-start and ptt-end. Whisper must
// never receive audio outside a PTT session.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.targetRate = o.targetRate || 16000;
    this.ratio = sampleRate / this.targetRate;

    this.frameSize = 1024;                        // output samples per message
    this.out = new Int16Array(this.frameSize);
    this.outIndex = 0;

    this.tail = new Float32Array(0);              // input carried into next block
    this.pos = 0;                                 // fractional read position in tail+input
  }

  flush() {
    if (this.outIndex === 0) return;
    const slice = this.out.slice(0, this.outIndex);
    this.port.postMessage(slice.buffer, [slice.buffer]);
    this.outIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];

    const buf = new Float32Array(this.tail.length + channel.length);
    buf.set(this.tail, 0);
    buf.set(channel, this.tail.length);

    let p = this.pos;
    while (Math.floor(p) + 1 < buf.length) {
      const i = Math.floor(p);
      const frac = p - i;
      let s = buf[i] * (1 - frac) + buf[i + 1] * frac;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.out[this.outIndex++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIndex === this.frameSize) this.flush();
      p += this.ratio;
    }

    // The read position can land past the end of this buffer. Clamping the
    // consumed count keeps the leftover fraction, so the next block starts at
    // the right phase instead of resyncing to its first sample (which would
    // emit a few too many samples per second and drift the pitch).
    const consumed = Math.min(Math.floor(p), buf.length);
    this.tail = buf.slice(consumed);
    this.pos = p - consumed;
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
