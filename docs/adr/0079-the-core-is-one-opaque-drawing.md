# 79. The core is one opaque drawing

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21 and from [0073](0073-edge-on-lines-and-core-cross-fade.md)'s cross-fade, requested by the owner. It is on in the core and on the page alike: it changes how the drawn core is placed, not what the model describes. A merger's third core is a bug fix.

## Context

The drawn core is the big mark at the centre of a disc galaxy, picked from the `core` drawings by bulge strength. v21 drew it at alpha 0.9, drew the line drawing below `incE` 70 and the dotted one above, and dropped it from `incE` 80. ADR 0073 made those two switches smooth (a cross-fade of the two styles over 66-74 and of the core's alpha over 66-80), which meant the core was half transparent over a range of angles and read as fading between two different drawings, a big black dot at one angle and a spiral at another. The owner wants the core to be what the galaxy has, always, opaque like everything else on the plate.

Separately, a merger drew a third core at the middle of the plate, between the two galaxies. The merger's sky host (ADR 0071) is a galaxy-less scene built from the main parameters, but its scene kept the full parameters (subject `galaxy`, bulge 0.2), and both engines drew a core at the plate centre from them.

## Decision

1. **One opaque drawing.** `coreInstances` (src/model/parts.ts) returns one instance at alpha 1 (v21 and ADR 0073: 0.9 times a fade), plus the nuclear spiral at alpha 1 when `nuclear` is on.
2. **The style comes from the galaxy, never the camera.** It is the dotted drawing when the galaxy is stipple-only (`stipple > 0.5 && lines < 0.5`), the line drawing otherwise. The core no longer swaps at `incE` 70, and `coreFade`, `coreDottedMix`, `CORE_FADE` and `CORE_STYLE` are removed.
3. **It stays edge-on**, flattened by `max(bulgeFlat, |cos i|)`, so by `bulgeFlat` at 90 degrees. v21 dropped it from `incE` 80.
4. **The sky host has no core.** A sky host scene returns the galaxy-less parameters as its `P`, so nothing that reads `scene.P` (the drawn core, the nuclear spiral) draws for it.

## Not modelled

- The whole drawing's pool switches (at `incE` 70 and 78, `wholeTypeOf`) are v21's and still swap, with `whole` on.

## Consequences

- No core fades or flicks between types under orbit, and none vanishes edge-on.
- A merger has two cores, one per galaxy.
- The v21 comparison of the core (`tests/unit/parts.test.ts`) holds below `incE` 66, where the drawing is the same.
