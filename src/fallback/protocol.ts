/** Messages between the page and the CPU engine's worker (ADR 0071). Every request has an `id`. */
import type { Params } from '../core/params';
import type { InkLayer } from '../render/layers';
import type { Plates } from '../render/plates';
import type { SurfaceName } from '../render/surface';
import type { ExportInfoData } from '../extras/export/engine';
import type { CpuDrawn, CpuSize } from './core';
import type { Orientation } from '../view/camera';

export type CpuRequest =
  | { id: number; op: 'init'; base: string; size: CpuSize }
  | { id: number; op: 'draw'; P: Params; zoom: number; home: Orientation }
  | { id: number; op: 'resize'; size: CpuSize }
  | { id: number; op: 'present'; surface: SurfaceName; plates: Plates }
  | { id: number; op: 'layers' }
  | { id: number; op: 'exportInfo' }
  | { id: number; op: 'ink' };

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
  | { id: number; ok: true; op: 'layers'; layers: readonly InkLayer[] }
  | { id: number; ok: true; op: 'exportInfo'; info: ExportInfoData }
  | {
      id: number;
      ok: true;
      op: 'ink';
      pixels: Uint8ClampedArray<ArrayBuffer>;
      width: number;
      height: number;
    }
  | { id: number; ok: false; error: string };
