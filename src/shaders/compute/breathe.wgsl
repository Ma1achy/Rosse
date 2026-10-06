// The breathing room round bright drawn stars (app23.js:L275-281): a pure view filter on the
// projected proposals (ADR 0004, 0010). Two entry points, with a compaction between them (the
// scan_* entry points of compute/scan.wgsl, run on `bkeys` and writing the bright stars' instances
// to `bright`):
//
//   bright_keys  per proposal: 0 when it is a bright drawn star that survived the culls, else
//                CLS_NONE, the key of the compaction;
//   clear        per proposal: an old, disc or young dot within 0.4 of a bright star's size of any
//                bright star is dropped (class CLS_NONE). The ring knots' and clumps' marks (index
//                >= n_main) are not touched: v21 makes them after the clearing.
//
// Distances are compared squared. CPU twin: src/fallback/kernels/breathe.ts.

// #import "common/instance.wgsl"
// #import "common/stipple-types.wgsl"

struct Room {
  // the proposals
  n_main: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}

@group(0) @binding(0) var<uniform> room: Room;
@group(0) @binding(1) var<storage, read> samples: array<Sample>;
@group(0) @binding(2) var<storage, read_write> classes: array<u32>;
@group(0) @binding(3) var<storage, read> projected: array<Instance>;
@group(0) @binding(4) var<storage, read_write> bkeys: array<u32>;
// the bright stars' instances, compacted (class 0 of the scan's output), and the scan's draw args
@group(0) @binding(5) var<storage, read> bright: array<Instance>;
@group(0) @binding(6) var<storage, read> bargs: array<u32>;

@compute @workgroup_size(64)
fn bright_keys(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= room.n_main) {
    return;
  }
  var k = CLS_NONE;
  if (classes[i] == CLS_RSTAR && (samples[i].cls & FLAG_BRIGHT) != 0u) {
    k = 0u;
  }
  bkeys[i] = k;
}

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= room.n_main) {
    return;
  }
  let c = classes[i];
  if (c != CLS_OLD && c != CLS_DISC && c != CLS_YOUNG) {
    return;
  }
  let p = projected[i].pos;
  let n = bargs[1];
  for (var k = 0u; k < n; k++) {
    let s = bright[k];
    let sz = sqrt(s.m.x * s.m.x + s.m.y * s.m.y);
    let r = 0.4 * sz;
    let dx = p.x - s.pos.x;
    let dy = p.y - s.pos.y;
    if (dx * dx + dy * dy < r * r) {
      classes[i] = CLS_NONE;
      return;
    }
  }
}
