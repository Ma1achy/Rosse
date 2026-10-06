// A source galaxy's projected stipple samples as lens marks (ADR 0008): the instance of
// compute/project.wgsl with its position taken into the source plane, (X - 400) * k (`ts` of
// buildSourceGalaxy, app23.js:L636), and its class. A sample the source's own culls removed keeps
// class 255 and is never solved. CPU twin: src/fallback/kernels/lens.ts `sampleMark`.

// #import "common/instance.wgsl"

// LMARK_LAYOUT in src/render/lens.ts
struct LMark {
  b: vec2<f32>,
  layer: u32,
  alpha: f32,
  m: vec4<f32>,
  cls: u32,
  src: u32,
  pad0: u32,
  pad1: u32,
}

struct Job {
  // samples, the first mark of this source, its index, its scale (plate px to source plane)
  n: u32,
  first: u32,
  src: u32,
  k: f32,
}

@group(0) @binding(0) var<uniform> job: Job;
@group(0) @binding(1) var<storage, read> projected: array<Instance>;
@group(0) @binding(2) var<storage, read> classes: array<u32>;
@group(0) @binding(3) var<storage, read_write> marks: array<LMark>;

@compute @workgroup_size(64)
fn gather_marks(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= job.n) {
    return;
  }
  let p = projected[i];
  marks[job.first + i] = LMark(
    vec2<f32>((p.pos.x - 400.0) * job.k, (p.pos.y - 400.0) * job.k),
    p.layer,
    p.alpha,
    p.m,
    classes[i],
    job.src,
    0u,
    0u,
  );
}
