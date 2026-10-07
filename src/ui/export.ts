/**
 * PNG export: the plate as it is shown (surface, plates and size), saved as a file. The engine
 * gives the pixels (it composites into a texture and reads it back, or on the CPU engine reads its
 * own output), so the file is the same on both engines and does not depend on a canvas keeping its
 * drawing buffer.
 */
import type { Params } from '../core/params';
import type { ExportInfo } from '../extras/export/engine';
import type { InkLayer } from '../render/layers';

export interface Pixels {
  px: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export function pngBlob(p: Pixels): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no 2D canvas to encode the PNG'));
  ctx.putImageData(new ImageData(p.px, p.width, p.height), 0, 0);
  return new Promise((resolve, reject) => {
    c.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('the browser could not encode a PNG'));
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/**
 * What an export reads from the engine, in place of the engine (whose interface is private to
 * src/main.ts): the PNG uses `snapshot`; M12's SVG export reads `layers()` back on demand (never on
 * the frame path), and its GIF re-draws moments of the timeline through the page.
 */
export interface ExportSource {
  backend(): 'webgpu' | 'cpu';
  /** the plate as shown, composited for the surface and plates now (queued after any frame) */
  snapshot(): Promise<Pixels>;
  /**
   * the ink layers of the last drawing, in draw order; empty before the first frame. The CPU
   * engine's are in its worker (M10, ADR 0071), so they may come back by message.
   */
  layers(): readonly InkLayer[] | Promise<readonly InkLayer[]>;
  /** the GPU device of the engine drawing now, or null on the CPU engine */
  device(): GPUDevice | null;
  /**
   * What the SVG needs that the layers do not carry: the drawing's seed, its pens' metadata
   * (`dots.size`, `strokes`) and the roles of a single galaxy's placed capsules. Read it inside
   * `exclusive`, with the layers.
   */
  exportInfo(): Promise<ExportInfo>;
  /**
   * Runs `job` holding the engine: no frame is drawn until it ends (the page's own queue), and the
   * GPU's buffers the layers are read from stay the frame's. Afterwards the plate is put back to
   * its size and drawn again. `ink` is for a GIF: a drawing's key ink alone, premultiplied RGBA8 at
   * `size` × `size`, drawn with the page's zoom and home orientation.
   */
  exclusive<T>(job: (x: ExclusiveExport) => Promise<T>): Promise<T>;
}

export interface ExclusiveExport {
  ink(P: Params, size: number): Promise<Uint8ClampedArray>;
}
