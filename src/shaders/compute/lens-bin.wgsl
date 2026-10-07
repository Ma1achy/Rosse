// Lens pass 2: each grid triangle's bounding box in the source plane, counted, prefix-summed and
// scattered into source-plane bins, with the triangle ids of every bin sorted ascending (ADR 0008,
// 0004). Reference: the second loop of lensSolver (app23.js:L613-622).
//
// Entry points, in dispatch order, one solver at a time (`job.s`):
//   bin_count      one triangle: its bins (a box of integer bin indices, clamped; a box covering
//                  more than 400 bins straddles a caustic and is skipped) and an atomic add on
//                  each bin's count. Integer adds commute, so the counts are exact;
//   scan_local     per 256 bins, the exclusive prefix of the counts and the block's total;
//   scan_blocks    ONE invocation: the blocks' totals as running offsets;
//   scan_add       each bin's offset (the grand total after the last), in `offsets`;
//   bin_scatter    one triangle: its id into each of its bins' ranges, at an atomic cursor. The
//                  order within a bin is whatever the atomics give, so
//   bin_sort       one bin: an insertion sort of its ids ascending, which makes the bin's contents
//                  independent of scheduling (a bin holds a few ids; the worst are a few hundred).
//
// The grid's extent in the source plane is in `solvers[job.s]` (compute/lens-grid.wgsl).
// CPU twin: src/fallback/kernels/lens.ts `binKernels`.

// #import "common/lens-types.wgsl"

struct Job {
  s: u32,
}

const MAX_BINS: u32 = 400u;
const SCAN_BLOCK: u32 = 256u;

@group(0) @binding(0) var<storage, read> solvers: array<Solver>;
@group(0) @binding(1) var<storage, read> verts: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> job: Job;
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> cursor: array<atomic<u32>>;
// the bins' offsets (from `obase`), then the triangle ids of every bin (from `ibase`)
@group(0) @binding(5) var<storage, read_write> bins: array<u32>;
@group(0) @binding(7) var<storage, read_write> local_rank: array<u32>;
@group(0) @binding(8) var<storage, read_write> block_totals: array<u32>;

// A triangle's bins as (ix0, ix1, iy0, iy1); ix1 < ix0 for a skipped triangle.
fn triangle_bins(S: Solver, t: u32) -> vec4<i32> {
  let v = triangle_verts(t, S.g);
  let p0 = verts[S.vbase + v.x];
  let p1 = verts[S.vbase + v.y];
  let p2 = verts[S.vbase + v.z];
  let hi = f32(S.g - 1u);
  let ix0 = i32(clamp(floor((min(p0.z, min(p1.z, p2.z)) - S.bx0) / S.cw), 0.0, hi));
  let ix1 = i32(clamp(floor((max(p0.z, max(p1.z, p2.z)) - S.bx0) / S.cw), 0.0, hi));
  let iy0 = i32(clamp(floor((min(p0.w, min(p1.w, p2.w)) - S.by0) / S.ch), 0.0, hi));
  let iy1 = i32(clamp(floor((max(p0.w, max(p1.w, p2.w)) - S.by0) / S.ch), 0.0, hi));
  if (u32((ix1 - ix0 + 1) * (iy1 - iy0 + 1)) > MAX_BINS) {
    return vec4<i32>(1, 0, 0, 0);
  }
  return vec4<i32>(ix0, ix1, iy0, iy1);
}

@compute @workgroup_size(64)
fn bin_count(@builtin(global_invocation_id) id: vec3<u32>) {
  let S = solvers[job.s];
  let t = id.x;
  if (t >= 2u * S.g * S.g) {
    return;
  }
  let b = triangle_bins(S, t);
  if (b.y < b.x) {
    return;
  }
  for (var y = b.z; y <= b.w; y++) {
    for (var x = b.x; x <= b.y; x++) {
      atomicAdd(&counts[S.obase + u32(y) * S.g + u32(x)], 1u);
    }
  }
}

var<workgroup> tmp: array<u32, 256>;

@compute @workgroup_size(256)
fn scan_local(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let S = solvers[job.s];
  let i = wid.x * SCAN_BLOCK + lid.x;
  var c = 0u;
  if (i < S.g * S.g) {
    c = atomicLoad(&counts[S.obase + i]);
  }
  tmp[lid.x] = c;
  workgroupBarrier();
  for (var off = 1u; off < SCAN_BLOCK; off = off * 2u) {
    var v = tmp[lid.x];
    if (lid.x >= off) {
      v = v + tmp[lid.x - off];
    }
    workgroupBarrier();
    tmp[lid.x] = v;
    workgroupBarrier();
  }
  if (i < S.g * S.g) {
    local_rank[i] = tmp[lid.x] - c;
  }
  if (lid.x == SCAN_BLOCK - 1u) {
    block_totals[wid.x] = tmp[lid.x];
  }
}

@compute @workgroup_size(1)
fn scan_blocks() {
  let S = solvers[job.s];
  let blocks = (S.g * S.g + SCAN_BLOCK - 1u) / SCAN_BLOCK;
  var run = 0u;
  for (var b = 0u; b < blocks; b++) {
    let t = block_totals[b];
    block_totals[b] = run;
    run = run + t;
  }
  bins[S.obase + S.g * S.g] = run;
}

@compute @workgroup_size(64)
fn scan_add(@builtin(global_invocation_id) id: vec3<u32>) {
  let S = solvers[job.s];
  let i = id.x;
  if (i >= S.g * S.g) {
    return;
  }
  bins[S.obase + i] = local_rank[i] + block_totals[i / SCAN_BLOCK];
}

@compute @workgroup_size(64)
fn bin_scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let S = solvers[job.s];
  let t = id.x;
  if (t >= 2u * S.g * S.g) {
    return;
  }
  let b = triangle_bins(S, t);
  if (b.y < b.x) {
    return;
  }
  for (var y = b.z; y <= b.w; y++) {
    for (var x = b.x; x <= b.y; x++) {
      let bin = S.obase + u32(y) * S.g + u32(x);
      let at = bins[bin] + atomicAdd(&cursor[bin], 1u);
      if (at < S.id_cap) {
        bins[S.ibase + at] = t;
      }
    }
  }
}

@compute @workgroup_size(64)
fn bin_sort(@builtin(global_invocation_id) id: vec3<u32>) {
  let S = solvers[job.s];
  let b = id.x;
  if (b >= S.g * S.g) {
    return;
  }
  let lo = bins[S.obase + b];
  let hi = min(bins[S.obase + b + 1u], S.id_cap);
  for (var i = lo + 1u; i < hi; i++) {
    let key = bins[S.ibase + i];
    var j = i;
    while (j > lo && bins[S.ibase + j - 1u] > key) {
      bins[S.ibase + j] = bins[S.ibase + j - 1u];
      j = j - 1u;
    }
    bins[S.ibase + j] = key;
  }
}
