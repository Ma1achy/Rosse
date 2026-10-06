# M5: vector marks

The drawn parts are drawn: envelopes, whole drawings (rewound to the galaxy's pitch), drawn arms, bars and rings, bubbles at the clumps, the nuclear spiral, arcs, shells, the tail, trails and cosmic rays, the arrow, the jet and the stellar streams, every one a hand-drawn vector drawing expanded into pen capsules, dots and blobs on the GPU. All numbers below are from Chromium 141 with WebGPU on SwiftShader (Playwright 1.56.1) and the CPU engine in Node 22.

| new engine (WebGPU) beside v21 | |
| --- | --- |
| `Hand-drawn arms`, seed 7, home | `hand-drawn-arms-s7.jpg` |
| `Barred spiral`, seed 4242, orbit camera | `barred-spiral-s4242-orbit.jpg` |
| `Radio jet`, seed 7, zoom 2 | `radio-jet-s7-zoom.jpg` |

These are the `vectors` variant (below), drawn as the golden runner draws them, with v21's variation, stroke choices, noise and part picks, so both sides show the same galaxy (`node tools/gpu-test/side-by-side.mjs --set m5`; the new engine's ink is shown over the plate's field colour). The page (`?variant=vectors`) draws the same presets with the engine's own picks.

## What is built

- **The library on the GPU** (`marks/vector.ts`, ADR 0006): all 12 vector sheets (429 drawings) packed once into shared tables: 23,431 segments, 6,038 dots and 328 blobs, a per-drawing range table, and the prefix of each segment's densified piece count (86,280 pieces at ≤ 0.012 tile units, used only under a warp). The packer copies every sheet with its metadata (packer 4).
- **Parts placement as scene description** (`model/parts.ts`):
  - The model tier (`describeParts`) makes every choice of v21's `parts()` (L987–1086) by v21's rules:
    - envelopes, halo or disc;
    - whole drawings matched to the type (`wholeTypeOf`: the structure predicates of ADR 0017, including L1000's `smooth:elongated`), with v21's doubled spiral pool;
    - drawn arms by tightness class, each copying the first or not;
    - non-solid bars, rings, the nuclear spiral;
    - arcs, drawn shells, the tail's pen line;
    - trails and cosmic rays and the field-gated arrow, at v21's fixed plate positions (v21 parity: they ignore the zoom, reference notes 20.15);
    - bubbles (a `rings` curve at a clump, with probability 0.6 · bubbles), the jet (the `misc` spring, both ways);
    - the streams (a pen line's longest polyline bent round the galaxy, in the plate: v21 parity, it ignores the camera).

    Each part has its own index on the `parts` stream (`PartIndex`), so turning the jet on no longer changes the bar.
  - The view tier (`vectorRows`) lays out v21's rows `[x, y, tile, alpha, m, ps, warp]` for a camera (`discM`, the scale, the bubbles' projected clumps), in the `MAGNIFIED` order, a few dozen per galaxy.
  - The drawn core of M2 is extended with the nuclear spiral (`coreInstances`).
- **`compute/vector-expand.wgsl`** with its CPU twin `fallback/kernels/vector.ts`:
  - `expand_caps`: one capsule slot per segment, or, under a warp, per densified piece. Its instance is found by binary search on the slots, its piece by binary search on the densified prefix. Both ends go through `tf`: the warp, the column-major matrix and translation, then the hand wobble. The capsule's half width is `PEN.line/2 · ps` plate px (spike variant A2's coverage).
  - The warps:
    - `rewind`, θ += dk · ln(r/0.08), mirrored first for a Z-wise drawing, nothing within 0.015 of the centre (`rewindFn`, L842–845), turned by `cos_f`/`sin_f` with no `atan2`;
    - a generic `post` hook (a plate affine about a centre) for the tides and lens Jacobians of M8 and M9.

    Under a warp, segments longer than 22 px are dropped; under `post`, also those stretched more than 1.8× (L1207–1208).
  - `expand_dots`: a vector dot becomes a `dots` sprite from the hand, `VAR.dotPool[|round(997x + 131y)| % len]`, sized `dotSprite(t, clamp(2r·sc·0.42/2.6, 0.8, 1.6)·max(0.55, ps))`.
  - `expand_blobs`: a blob becomes a `knots` sprite, `VAR.knotPool[|round(991 cx)| % 24]`, with the matrix `M·R(θ)·S(max(1.7 rx, 3/sc), …)`.
  - `stream_marks`: the streams' dots and knots, one slot per 2.4 px of the bent pen line, kept with probability 0.55 + 0.45 · streams, one in 25 a knot, jittered by 1.4 px, on their own stream (`partMarks`) keyed by the placement key.
  - Two deterministic compactions (`scan_local`, `scan_blocks`, scatter; ADR 0004): the kept capsules, and the streams' dots and knots, in slot order, with indirect draw arguments. Capsules are drawn with `drawIndirect` (`[6n, 1, 0, 0]`); the stream marks as indirect sprites.
  - v21 parity: every vertex, dot and blob is drawn at alpha 1, whatever the row's alpha (reference notes 20.10: the ring at 0.55 is drawn at full strength).
- **Draw order** exactly as `scene()` (L1289–1301): stroke ribbons; every vector drawing's lines, dots and blobs (the hatching's, then the parts'), in line ink; pieces; the stipple's old, disc and young dots; the streams' dots and knots (old ink); knots; sparkle stars; the core and the nuclear spiral (old ink). v21 expands every vector sheet, the bars, rings and arcs included, into the one line-ink layer and empties their own sprite layers (L1287), so they are drawn there and not in `old` or `young` ink.
- **Both engines** draw the same layers (`GpuStipple.inkLayers`, `CpuStipple.view`).
- **The used-drawings count** (`model/used.ts`): the sources v21's `USED` collects, counted from what the CPU engine draws. It does not yet count the drawn stars (M7) or the carving lines' pen lines.
- **The page** draws every part with the engine's own picks (`?variant=vectors` gives the golden overrides).

RESULTS
