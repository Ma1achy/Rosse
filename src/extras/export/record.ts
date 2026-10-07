/**
 * Recording a GIF: the surface M11's "Export GIF" button calls, and the one M8's merger timeline
 * and M9's quasar flare plug into (`timelineSource`, ./sources.ts).
 *
 * ```ts
 * const bytes = await recordGif(
 *   timelineSource(400, 400, P, (Q) => drawInk(Q)),       // `drawInk(Q)`: the engine's ink for Q, RGBA8
 *   { frames: 60, end: 2, speed: 1, paper: [230, 222, 206], ink: [29, 27, 25], mode: 'ramp' },
 *   encodeInWorker,
 *   (k, n) => { button.textContent = `Rendering ${k} / ${n}…`; },
 *   () => restoreTheMoment(),                              // always runs: put `mTime` back
 * );
 * // save: new Blob([bytes], { type: 'image/gif' }), file name gifFileName(seed)
 * ```
 *
 * Memory: each frame is quantised to one byte a pixel (v21's `frames`) as soon as it arrives and
 * the RGBA frame is dropped, so a recording holds `frames × width × height` bytes (49 MB at v21's
 * largest, 640 px and 120 frames), not four times that. One recording at a time (v21's `GIFBUSY`):
 * a second call while one runs is refused.
 *
 * `frame(t)` draws one moment and returns the ink as premultiplied RGBA8 (`cpuInkFrame`,
 * `gpuInkFrame` in ./gif-frames.ts). The paper and chalkboard colours are the engine's surfaces
 * (src/render/surface.ts: Paper #e6dece = 230, 222, 206; Chalkboard #262b28 = 38, 43, 40).
 */
import {
  checkSpec,
  frameTime,
  gifDelayCs,
  quantiseFrame,
  type GifMode,
  type GifSpec,
  type Rgb,
} from './gif';

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

/** Encodes frames of palette indices (one byte a pixel). */
export type GifEncoder = (
  frames: readonly Uint8Array[],
  spec: GifSpec,
) => Promise<Uint8Array> | Uint8Array;

/** The times of the frames of a recording. */
export function frameTimes(n: number, end: number): number[] {
  return Array.from({ length: n }, (_, k) => frameTime(k, n, end));
}

let recording = false;

/**
 * Draws every frame in turn (yielding between them), quantising each as it arrives, then encodes.
 * `done` runs when the recording ends, however it ends (restore the page's `mTime` there).
 */
export async function recordGif(
  src: GifSource,
  rec: GifRecording,
  encode: GifEncoder,
  onProgress: (done: number, total: number) => void = () => undefined,
  done: () => void | Promise<void> = () => undefined,
): Promise<Uint8Array> {
  if (recording) throw new Error('a GIF is already being recorded');
  if (!(rec.frames >= 1)) throw new Error('a GIF needs at least one frame');
  const spec: GifSpec = {
    width: src.width,
    height: src.height,
    paper: rec.paper,
    ink: rec.ink,
    mode: rec.mode,
    delayCs: gifDelayCs(rec.speed, rec.end, rec.frames),
  };
  checkSpec(spec);
  recording = true;
  try {
    const frames: Uint8Array[] = [];
    for (const t of frameTimes(rec.frames, rec.end)) {
      const rgba = await src.frame(t);
      if (rgba.length !== src.width * src.height * 4)
        throw new Error('a frame is not width × height RGBA pixels');
      frames.push(quantiseFrame(rgba, spec));
      onProgress(frames.length, rec.frames);
      await new Promise((ok) => setTimeout(ok, 0));
    }
    return await encode(frames, spec);
  } finally {
    recording = false;
    await done();
  }
}

/** Encodes in the GIF worker (the frames' buffers are transferred). */
export function encodeInWorker(frames: readonly Uint8Array[], spec: GifSpec): Promise<Uint8Array> {
  checkSpec(spec);
  const worker = new Worker(new URL('./gif-worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Uint8Array>((ok, fail) => {
    worker.onmessage = (e: MessageEvent<{ bytes?: Uint8Array; error?: string }>) => {
      if (e.data.bytes) ok(e.data.bytes);
      else fail(new Error(e.data.error ?? 'the GIF worker failed'));
    };
    worker.onerror = (e) => {
      fail(new Error(e.message));
    };
    worker.onmessageerror = () => {
      fail(new Error('the GIF worker sent a message that could not be read'));
    };
    try {
      const buffers = frames.map((f) => f.buffer as ArrayBuffer);
      worker.postMessage({ frames: buffers, spec }, { transfer: buffers });
    } catch (e) {
      fail(e instanceof Error ? e : new Error(String(e)));
    }
  }).finally(() => {
    worker.terminate();
  });
}

/** The file name for a galaxy's GIF. */
export function gifFileName(seed: number): string {
  return `rosse-merger-${String(seed)}.gif`;
}
