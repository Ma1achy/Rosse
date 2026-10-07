// The lens solver's description, shared by the lens passes (compute/lens-grid.wgsl, lens-bin.wgsl,
// lens-query.wgsl; ADR 0008). Twin of SOLVER_LAYOUT in src/render/lens.ts.
//
// One entry per solver (the main source plane, and the double ring's second one). The static
// fields are written when the lens is described; `bx0 .. ch` by `grid_finish` once the grid's
// extent in the source plane is known.

struct Solver {
  // cells per side, vertices per side, halos
  g: u32,
  n: u32,
  n_halo: u32,
  // first vec4 of its halos in `halos` (three per halo: x y cos sin | q s e kk | b q_raw 0 0)
  hbase: u32,
  // first vertex in `verts`, first entry of `offsets` and `counts`, first id in `ids`, id capacity
  vbase: u32,
  obase: u32,
  ibase: u32,
  id_cap: u32,
  // half width of the image plane, the source plane's strength, a cell's size
  r: f32,
  f: f32,
  cell: f32,
  // external shear: g, cos 2 phi, sin 2 phi
  sh_g: f32,
  sh_c2: f32,
  sh_s2: f32,
  pad0: f32,
  pad1: f32,
  // the grid's extent in the source plane: lower corner and bin size
  bx0: f32,
  by0: f32,
  cw: f32,
  ch: f32,
}

// A triangle's three vertices: the cell's two halves, [a0, a1, a3] then [a0, a3, a2]
// (lensSolver, app23.js:L616-617).
fn triangle_verts(t: u32, g: u32) -> vec3<u32> {
  let n = g + 1u;
  let cell = t >> 1u;
  let i2 = cell % g;
  let j2 = cell / g;
  let a0 = j2 * n + i2;
  let a2 = a0 + n;
  if ((t & 1u) != 0u) {
    return vec3<u32>(a0, a2 + 1u, a2);
  }
  return vec3<u32>(a0, a0 + 1u, a2 + 1u);
}
