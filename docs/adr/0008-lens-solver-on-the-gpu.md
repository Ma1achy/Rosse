# 8. The lens solver on the GPU: grid, binned triangles, canonical image lists, explicit source orientation

Date: 2026-10-03

## Status

Accepted

## Context

The reference lenses a source galaxy mark by mark (app23.js:L594–707):

1. **Model.** Cored non-singular isothermal ellipsoids (Keeton 2001) plus external shear give the deflection α(x) (`lensModel`, L594–606). A cluster has 1 + 7–11 halos. The "double" preset adds a second source plane at 1.42× the lensing strength.
2. **Mesh** (`lensSolver`, L608–628). A (G+1)² grid over the image plane (G = 210, or 250 for a cluster, so 44k–63k vertices) is mapped to the source plane, β = x − α(x). Its 2G² triangles (88k–125k) are binned by their source-plane bounding box into G × G bins. A triangle covering more than 400 bins straddles a caustic and is skipped.
3. **Images.** For a source point, every triangle in its bin is tested with barycentric coordinates. Each hit gives an image position, the local Jacobian ∂x/∂β, and magnification μ = det J, whose sign is the parity. Duplicates closer than 0.6 cell are dropped, keeping the _first found_. That depends on bin insertion order, which is triangle order.
4. **Marks** (`lensMarks`, L646–670). A source galaxy is built exactly like a main galaxy, in its own plane (`buildSourceGalaxy`, L630). Then:
   - every stipple dot becomes ⌊κ·|μ| + u⌋ dots, jittered through J;
   - knots and stars are kept with probability 0.55 and scaled by μ^¼;
   - vector drawings are warped through J per image;
   - curves are resampled at half a cell and traced into branches by greedy nearest matching, so they break where the images part.
5. **Source position** (`srcNow`, L450). The source is fixed in 3D at a depth behind the lens, in the orientation the camera had _when the lens key was first seen_ (`homeFor`, L445). Orbiting moves the source's projected offset and re-runs everything. This history is hidden state: the same parameters give different images depending on how you navigated (docs/reference-notes.md, flagged item 2).

The sizes per render are as follows. Queries number at most about 30k: the source galaxy's 2.2k–6k sprites plus curve samples, plus up to 9 cluster sources. Images per query are at most 5 in practice.

## Decision

The work is split across the cache tiers of ADR 0010:

- **Lens tier** (rebuilt when lens parameters change, not when the camera moves; the image plane is fixed to the lens, and the plate rotation `pa` is applied at the end):
  - `lens-grid.wgsl`: one thread per vertex computes β and stores (x, β) as `vec4<f32>`.
  - `lens-bin.wgsl`: one thread per triangle computes the source-plane bounding box (in f32, with integer bin indices) and skips it at more than 400 bins. Then a count pass (atomic integer adds, which are commutative), a prefix sum over the bins, and a scatter pass. Within each bin, triangle ids are then **sorted ascending** (bins average fewer than 10 entries, so an insertion sort per bin is fine). This makes bin contents independent of scheduling.
- **View tier** (rebuilt on orbit, because the source's projected offset changes):
  - `lens-query.wgsl`: one thread per source point walks its bin in triangle-id order, collects hits (at most 8), and de-duplicates in that canonical order. It writes images with position, J, μ and parity into fixed slots: `query × 8`.
  - Emission: one thread per (source mark, image) slot computes its output count (the stipple's ⌊κ·|μ| + u⌋ with u from the counter RNG keyed by mark and image), then scan and write. κ needs the total magnification over all images (L651–652): a reduction pass first, using an integer sum of μ in fixed point, so it is deterministic.
  - Curve branch tracking: one thread per curve (at most tens of curves, at most 500 samples each) runs the reference's greedy matcher sequentially over its samples. It is cheap and keeps the reference's behaviour.
  - Warped vector drawings use the per-image affine J in `vector-expand.wgsl` (ADR 0006).
- **Explicit home orientation.** The orientation at which sources and overlays are fixed (`lensHome`, `overlayHome`: incl, az, winding) becomes a parameter. It is set from the camera when a lens preset is chosen and saved with the drawing, so a render is a pure function of its parameters. The page reproduces the reference's feel by setting it the first time a lens is shown.
- The quasar's time-delay flare needs the lensing potential ψ, evaluated per image. It is computed in the query pass.
- Weak lensing of the deep field round a cluster (L1273–1278) is a per-background-galaxy 2×2 distortion from finite differences of α. It is computed in the sky pass.

## Consequences

- Rebuild cost on orbit is queries plus emission only, about 30k threads, instead of the reference's full rebuild (1.6 s for a cluster on SwiftShader).
- Memory for the lens tier is about 63k × 16 B for the grid, 125k × 4 B for triangle ids, and bin offsets: under 4 MB.
- Image lists are identical on every run of the same adapter (L0). Across adapters, an image within a few ULPs of a triangle edge can change bins. Such an image is still found once by its neighbour triangle, so lists differ at most in images sitting on a caustic, where μ is huge and is clamped anyway (`min(30, |μ|)`).
- The explicit home orientation is a deliberate divergence (ADR 0005), and the user must confirm it (open question Q3).
