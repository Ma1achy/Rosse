/**
 * The GIF worker: encodes the (already quantised) frames off the main thread (v21 does it between
 * two `setTimeout`s on the page). Started by `encodeInWorker` (./record.ts).
 * Messages: `{ frames: ArrayBuffer[] (palette indices), spec: GifSpec }` in, `{ bytes: Uint8Array }` or `{ error }`
 * out; the frames' buffers are transferred, not copied.
 */
import { encodeIndexed, type GifSpec } from './gif';

interface Job {
  frames: ArrayBuffer[];
  spec: GifSpec;
}

self.onmessage = (e: MessageEvent<Job>) => {
  try {
    const bytes = encodeIndexed(
      e.data.frames.map((f) => new Uint8Array(f)),
      e.data.spec,
    );
    self.postMessage({ bytes }, { transfer: [bytes.buffer] });
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
