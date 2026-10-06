/**
 * Deterministic compaction by class, CPU twin of src/shaders/compute/scan.wgsl (ADR 0004): the
 * projected samples are split into one instance list per class (old, disc, young, knot, star,
 * rstar), each in sample order, so the output never depends on thread scheduling.
 *
 * Three passes, as on the GPU:
 * 1. `scanLocal`: per block of SCAN_BLOCK samples, the exclusive prefix count of each sample's
 *    class within its block, and the block's per-class totals. On the GPU this is a work-group
 *    scan (Hillis–Steele) over the counts packed three classes to a word, 10 bits each.
 * 2. `scanBlocks`: the exclusive prefix of the block totals (each block's offset per class), the
 *    per-class totals, and the indirect draw arguments `[4, count, 0, 0]` per class.
 * 3. `scatter`: each kept sample's instance to `out[class · cap + blockOffset + local]`.
 */
import { CLASS_COUNT } from './stipple';
import { INSTANCE_WORDS } from './project';

export const SCAN_BLOCK = 256;
/** Words per block in the block-offset table (CLASS_COUNT rounded up). */
export const BLOCK_STRIDE = 8;

/** Per-class capacity of the output: n rounded up to a multiple of 8 (256-byte aligned slices). */
export function classCapacity(n: number): number {
  return Math.max(8, Math.ceil(n / 8) * 8);
}

export function blockCount(n: number): number {
  return Math.max(1, Math.ceil(n / SCAN_BLOCK));
}

export function scanLocal(
  classes: Uint32Array,
  n: number,
): { local: Uint32Array; blockTotals: Uint32Array } {
  const blocks = blockCount(n);
  const local = new Uint32Array(Math.max(1, n));
  const blockTotals = new Uint32Array(blocks * BLOCK_STRIDE);
  for (let b = 0; b < blocks; b++) {
    const run = new Uint32Array(BLOCK_STRIDE);
    for (let i = b * SCAN_BLOCK; i < Math.min(n, (b + 1) * SCAN_BLOCK); i++) {
      const c = classes[i] ?? 255;
      if (c < CLASS_COUNT) {
        local[i] = run[c] ?? 0;
        run[c] = (run[c] ?? 0) + 1;
      }
    }
    blockTotals.set(run, b * BLOCK_STRIDE);
  }
  return { local, blockTotals };
}

export function scanBlocks(
  blockTotals: Uint32Array,
  blocks: number,
): { blockOffsets: Uint32Array; counts: Uint32Array; args: Uint32Array } {
  const blockOffsets = new Uint32Array(blocks * BLOCK_STRIDE);
  const run = new Uint32Array(BLOCK_STRIDE);
  for (let b = 0; b < blocks; b++)
    for (let c = 0; c < CLASS_COUNT; c++) {
      blockOffsets[b * BLOCK_STRIDE + c] = run[c] ?? 0;
      run[c] = (run[c] ?? 0) + (blockTotals[b * BLOCK_STRIDE + c] ?? 0);
    }
  const counts = run.slice(0, CLASS_COUNT);
  const args = new Uint32Array(CLASS_COUNT * 4);
  for (let c = 0; c < CLASS_COUNT; c++) args.set([4, counts[c] ?? 0, 0, 0], c * 4);
  return { blockOffsets, counts, args };
}

export function scatter(
  classes: Uint32Array,
  n: number,
  local: Uint32Array,
  blockOffsets: Uint32Array,
  inst: Uint32Array,
  cap: number,
  out: Uint32Array,
): void {
  for (let i = 0; i < n; i++) {
    const c = classes[i] ?? 255;
    if (c >= CLASS_COUNT) continue;
    const b = Math.floor(i / SCAN_BLOCK);
    const dst = c * cap + (blockOffsets[b * BLOCK_STRIDE + c] ?? 0) + (local[i] ?? 0);
    out.set(inst.subarray(i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS), dst * INSTANCE_WORDS);
  }
}

/** All three passes: per-class instance lists (as one buffer of CLASS_COUNT × cap slots). */
export function compact(
  classes: Uint32Array,
  n: number,
  inst: Uint32Array,
): { out: Uint32Array; counts: Uint32Array; args: Uint32Array; cap: number } {
  const cap = classCapacity(n);
  const { local, blockTotals } = scanLocal(classes, n);
  const { blockOffsets, counts, args } = scanBlocks(blockTotals, blockCount(n));
  const out = new Uint32Array(CLASS_COUNT * cap * INSTANCE_WORDS);
  scatter(classes, n, local, blockOffsets, inst, cap, out);
  return { out, counts, args, cap };
}
