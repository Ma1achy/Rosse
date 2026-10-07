/** Messages between the page and the CPU engine's worker (ADR 0071). Every request has an `id`. */
import type { Params } from '../core/params';
import type { Plates } from '../render/plates';
import type { SurfaceName } from '../render/surface';
import type { CpuDrawn, CpuSize } from './core';

export type CpuRequest =
  | { id: number; op: 'init'; base: string; size: CpuSize }
  | { id: number; op: 'draw'; P: Params; zoom: number }
  | { id: number; op: 'resize'; size: CpuSize }
  | { id: number; op: 'present'; surface: SurfaceName; plates: Plates };

export type CpuReply =
  | { id: number; ok: true; op: 'init' | 'resize' }
  | ({ id: number; ok: true; op: 'draw' } & CpuDrawn)
  | {
      id: number;
      ok: true;
      op: 'present';
      pixels: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
    }
  | { id: number; ok: false; error: string };
