// Deterministic compaction by class (ADR 0004): the projected samples into one instance list per
// class, each in sample order, whatever the thread scheduling. Three entry points, dispatched in
// order:
//
// 1. scan_local (one work group per SCAN_BLOCK samples): a Hillis-Steele work-group scan of the
//    one-hot class counts, packed three classes to a word, 10 bits each (a block holds at most
//    256 of a class). Writes each kept sample's exclusive rank within its block and class, and
//    the block's totals.
// 2. scan_blocks (one invocation): the exclusive prefix of the block totals per class (each
//    block's offset), and the indirect draw arguments [4, count, 0, 0] per class, so draws never
//    wait on a read-back (ADR 0003). The loop runs over n / 256 blocks (about 200 at most).
// 3. scatter (one invocation per sample): out[class * cap + block offset + rank] = instance.
//
// CPU twin: src/fallback/kernels/scan.ts.

// #import "common/instance.wgsl"
// #import "common/stipple-types.wgsl"

const SCAN_BLOCK: u32 = 256u;
const BLOCK_STRIDE: u32 = 8u;

struct Scan {
  n: u32,
  cap: u32,
  blocks: u32,
  pad: u32,
}

@group(0) @binding(0) var<uniform> scan: Scan;
@group(0) @binding(1) var<storage, read_write> classes: array<u32>;
@group(0) @binding(2) var<storage, read_write> rank: array<u32>;
@group(0) @binding(3) var<storage, read_write> block_totals: array<vec2<u32>>;
@group(0) @binding(4) var<storage, read_write> block_offsets: array<u32>;
@group(0) @binding(5) var<storage, read_write> args: array<u32>;
@group(0) @binding(6) var<storage, read_write> projected: array<Instance>;
@group(0) @binding(7) var<storage, read_write> out: array<Instance>;

var<workgroup> tmp: array<vec2<u32>, 256>;

fn one_hot(c: u32) -> vec2<u32> {
  if (c < 3u) {
    return vec2<u32>(1u << (10u * c), 0u);
  }
  if (c < CLASS_COUNT) {
    return vec2<u32>(0u, 1u << (10u * (c - 3u)));
  }
  return vec2<u32>(0u);
}

fn field(v: vec2<u32>, c: u32) -> u32 {
  if (c < 3u) {
    return (v.x >> (10u * c)) & 1023u;
  }
  return (v.y >> (10u * (c - 3u))) & 1023u;
}

@compute @workgroup_size(256)
fn scan_local(@builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>) {
  let i = wid.x * SCAN_BLOCK + lid.x;
  var c = CLS_NONE;
  if (i < scan.n) {
    c = classes[i];
  }
  let one = one_hot(c);
  tmp[lid.x] = one;
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
  let inclusive = tmp[lid.x];
  if (i < scan.n && c < CLASS_COUNT) {
    rank[i] = field(inclusive - one, c);
  }
  if (lid.x == SCAN_BLOCK - 1u) {
    block_totals[wid.x] = inclusive;
  }
}

@compute @workgroup_size(1)
fn scan_blocks() {
  var run = array<u32, 6>(0u, 0u, 0u, 0u, 0u, 0u);
  for (var b = 0u; b < scan.blocks; b++) {
    let t = block_totals[b];
    for (var c = 0u; c < CLASS_COUNT; c++) {
      block_offsets[b * BLOCK_STRIDE + c] = run[c];
      run[c] = run[c] + field(t, c);
    }
  }
  for (var c = 0u; c < CLASS_COUNT; c++) {
    args[c * 4u] = 4u;
    args[c * 4u + 1u] = run[c];
    args[c * 4u + 2u] = 0u;
    args[c * 4u + 3u] = 0u;
  }
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= scan.n) {
    return;
  }
  let c = classes[i];
  if (c >= CLASS_COUNT) {
    return;
  }
  let dst = block_offsets[(i / SCAN_BLOCK) * BLOCK_STRIDE + c] + rank[i];
  out[c * scan.cap + dst] = projected[i];
}
