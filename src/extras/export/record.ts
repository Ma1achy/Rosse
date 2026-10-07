/**
 * Recording a GIF: the integration surface for M11's "Export GIF" button, and for M8's merger
 * timeline and M9's quasar flare, which supply the frames.
 *
 * ```ts
 * const bytes = await recordGif(
 *   { width: 400, height: 400, frame: (t) => inkFrameAt(t) },   // the ink of the plate at time t
 *   { frames: 60, end: 2, speed: 1, paper: [226, 217, 198], ink: [29, 27, 25], mode: 'ramp' },
 *   encodeInWorker,                                              // or `encodeGif` in Node
 *   (k, n) => { button.textContent = `Rendering ${k} / ${n}…`; },
 * );
 * // save: new Blob([bytes], { type: 'image/gif' }), file name gifFileName(seed)
 * ```
 *
 * `frame(t)` draws one moment and returns the ink as premultiplied RGBA8 (`cpuInkFrame`,
 * `gpuInkFrame` in ./gif-frames.ts). For the merger it sets the parameter `mTime = t` and runs the
 * frame; for the quasar flare the same `mTime`, which v21 reads for the flare as well (app23.js:L1722
 * and `tlUpdate`'s `lensSource === 'quasar'`). Merger and lens are M8 and M9: until they land the
 * source can be any parameter; the tests animate the orbit.
 */
import { frameTime, gifDelayCs, type GifMode, type GifSpec, type Rgb } from './gif';

export interface GifSource {
  width: number;
  height: number;
  /** The ink at time `t`, premultiplied RGBA8, `width × height × 4` bytes. */
  frame(t: number): Promise<Uint8ClampedArray>;
}

export interface GifRecording {
  /** number of frames */
  frames: number;
  /** the timeline's end (v21's `TL.end`, 0.2 to 30; t runs from 0 to end, the end not drawn) */
  end: number;
  /** playback speed (v21's 0.25 to 4) */
  speed: number;
  paper: Rgb;
  ink: Rgb;
  mode: GifMode;
}

export type GifEncoder = (
  frames: readonly Uint8ClampedArray[],
  spec: GifSpec,
) => Promise<Uint8Array> | Uint8Array;

/** The times of the frames of a recording. */
export function frameTimes(n: number, end: number): number[] {
  return Array.from({ length: n }, (_, k) => frameTime(k, n, end));
}

/** Draws every frame in turn (yielding between them), then encodes. */
export async function recordGif(
  src: GifSource,
  rec: GifRecording,
  encode: GifEncoder,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<Uint8Array> {
  if (!(rec.frames >= 1)) throw new Error('a GIF needs at least one frame');
  const frames: Uint8ClampedArray[] = [];
  for (const t of frameTimes(rec.frames, rec.end)) {
    frames.push(await src.frame(t));
    onProgress(frames.length, rec.frames);
    await new Promise((ok) => setTimeout(ok, 0));
  }
  return encode(frames, {
    width: src.width,
    height: src.height,
    paper: rec.paper,
    ink: rec.ink,
    mode: rec.mode,
    delayCs: gifDelayCs(rec.speed, rec.end, rec.frames),
  });
}

/** Encodes in the GIF worker (the frames' buffers are transferred). */
export function encodeInWorker(
  frames: readonly Uint8ClampedArray[],
  spec: GifSpec,
): Promise<Uint8Array> {
  const worker = new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' });
  return new Promise((ok, fail) => {
    worker.onmessage = (e: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
      worker.terminate();
      if (e.data.bytes) ok(e.data.bytes);
      else fail(new Error(e.data.error ?? 'the GIF worker failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      fail(new Error(e.message));
    };
    const buffers = frames.map((f) => f.buffer as ArrayBuffer);
    worker.postMessage({ frames: buffers, spec }, { transfer: buffers });
  });
}

/** The file name for a galaxy's GIF. */
export function gifFileName(seed: number): string {
  return `rosse-merger-${String(seed)}.gif`;
}
