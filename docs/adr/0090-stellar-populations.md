# 90. Stellar populations

Date: 2026-10-10

## Status

Proposed. A deliberate divergence from v21, requested by the owner, with `popAuto` ("Population detail", 0 in the core, 1 on the page; the colour preset is also called Stellar populations).

## Context

v21's stipple draws every dot the same way, independently, so a galaxy reads as an even grain, with one kind of star mark. The owner asked for the stars to look better in the monochrome drawing: populations with their own mark character, clustering, a brightness hierarchy and a halo with clusters.

## Decision

With `popAuto` (`GalaxyFlag.popAuto`, stipple kernel and its WGSL twin, one extra draw per branch only when on, so v21's streams are unchanged):

- **Mark character by population.** Old dots (bulge, halo) are drawn 0.78 of v21's size, young ones (in the arms) 1.3 times, the disc's as v21.
- **Clustering.** A disc or ring sample is thinned by a noise field at four and a half cycles per unit (`NoiseSalt.pop`): between clumps most are dropped (80% of the gap in the arms, 45% elsewhere), so stars gather in groups, most in the arms. 1.25 times the stipple samples offset the thinning.
- **Globular clusters.** 14% of the halo's samples are placed in one of six tight swarms (Gaussian sigma 0.07) at fixed places 0.9 to 2.6 units out, chosen from the galaxy's key.
- **Brightness hierarchy.** Faint drawn stars spread wider in size (log-normal sigma 0.55 against 0.38), bright ones have a steeper, longer-tailed size law and are likelier in the arms (0.05 + 0.2 against 0.05 + 0.13).

- **Spacing.** A star is likelier to stay near the jittered anchor of its 0.045-unit cell (kept with probability 0.3 + 0.7 · exp(-d² / 2σ²), σ = 0.35 cell), a blue-noise-like jittered grid with no lattice, and no clumps of random coincidence. A sample cannot see its neighbours, so the anchor is a hash of the cell; stipple samples rise to 1.7 times to offset the thinning.
- **Thick disc.** A tenth of the disc's stars are drawn 3.5 times higher above the plane, as old, finer dots.
- **Streams in the halo.** With `lineWorld` and streams, 22% of the halo's stars lie on the arc of a stream (ADR 0089): a band that is narrow at the progenitor and fans out along the orbit, on the stream's tilted plane. The orbits are one definition (src/model/stream-orbits.ts) read by the strokes, the stars and v21's pen-line streams, and reach the kernel in the `Galaxy` uniform.
- **Foreground softness.** With `depthAuto` a foreground star near the camera is drawn larger (up to 3 against 2.2 times) and fainter (down to 55%), so the foreground reads as a different depth from the galaxy.

The colour plate's tints are ADR 0091.

## Consequences

- Crisper arms, a graded old-to-young texture, even spacing, a faint thick disc, swarms and streams in the halo, on all kernel paths.
- The coloured star mode (the colour plate) is not touched; its marks would take the same population classes.
- One sample in some thousands may differ between CPU and GPU in the swarms (Gaussian draws are within tolerance, ADR 0004), allowed three per case in the GPU test.
