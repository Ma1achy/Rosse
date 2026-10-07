/**
 * PNG export: the plate as it is shown (surface, plates and size), saved as a file. The engine
 * gives the pixels (it composites into a texture and reads it back, or on the CPU engine reads its
 * own output), so the file is the same on both engines and does not depend on a canvas keeping its
 * drawing buffer.
 */
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
  /** the ink layers of the last drawing, in draw order; empty before the first frame */
  layers(): readonly InkLayer[];
  /** the GPU device of the engine drawing now, or null on the CPU engine */
  device(): GPUDevice | null;
}
