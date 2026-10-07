/**
 * The GIF worker: quantises and encodes the frames off the main thread (v21 does it between
 * two `setTimeout`s on the page). Started by `encodeInWorker` (./record.ts).
 * Messages: `{ frames: ArrayBuffer[], spec: GifSpec }` in, `{ bytes: Uint8Array }` or `{ error }`
 * out; the frames' buffers are transferred, not copied.
 */
import { encodeGif, type GifSpec } from './gif';

interface Job {
  frames: ArrayBuffer[];
  spec: GifSpec;
}

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const bytes = encodeGif(
      e.data.frames.map((f) => new Uint8ClampedArray(f)),
      e.data.spec,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
