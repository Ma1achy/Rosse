# 5. Parity with the reference is statistical, not sample-exact

Date: 2026-10-03

## Status

Accepted

## Context

The reference page is the oracle for behaviour. Being the same as it could mean three things:

- **(a) Sample-exact.** Port `mulberry32` and every sequential stream exactly, so each dot lands where it lands in v21. This would allow near-pixel-exact golden tests. It forbids parallel sampling (ADR 0004), keeps the re-roll on orbit, keeps `sin`-hash noise, and ties the new engine to every accident of the old one's code order.
- **(b) Statistical.** The same model (densities, profiles, arm shapes, components), the same drawings chosen by the same rules, the same pen weight, the same ink per area, and the same counts per class. The individual dots differ.
- **(c) Visual only**, judged by eye. That cannot be tested.

## Decision

Option (b). Parity means:

- the same model equations and constants;
- the same rules for choosing drawings, with the same pools;
- the same instance transforms and pen weights;
- the same draw order and inks;
- the same mark counts per class within tolerance;
- the same ink distribution at a scale coarser than one dot.

It is tested by the golden metric of ADR 0013 against renders of the reference captured by `tools/capture-reference/`.

Divergences we choose on purpose are listed in `docs/architecture.md` ("Deliberate divergences") and tested as such:

- stable marks under orbit;
- an explicit home orientation for lensed sources and overlays;
- per-layer mipmaps (no bleed between atlas cells).

## Consequences

- Golden tests compare distributions, not pixels (ADR 0013). They are weaker than pixel tests at catching one misplaced mark, and stronger at catching what matters: wrong density, wrong pen weight, missing components.
- Where the reference makes discrete choices from its RNG, the new engine makes the same kind of choice from its own RNG. Examples are which whole drawing, which arm drawing, or how many spurs. So for a given seed the two engines may pick _different_ drawings. Golden comparisons are therefore made on structure metrics that are independent of the specific drawing, and mark-count tolerances are per class.
- If sample-exact parity is ever needed for one feature (a regression hunt), a debugging build can feed reference-generated instance buffers into the new renderer: the renderer stays testable on its own.
