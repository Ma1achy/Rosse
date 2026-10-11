# 72. The lensed source follows the lens frame

Date: 2026-10-09

## Status

Proposed, and now optional (see the amendment at the end). A deliberate divergence from v21, decided by the owner; it refines [0050](0050-the-lens-marks-slots-and-explicit-home.md) (explicit home) and keeps [0017](0017-model-tier-key-is-a-structure-signature.md)'s tiers.

## Context

v21's lens mass model lies in the screen plane (rotated only by the roll `pa`), while each source is fixed in 3D behind it: `srcNow` (app23.js:L450) is `rotFwd(rotInv([bx, by, -D], home), now)`, with D = 2.5 thE for the main source (`lensSprites10`, L680). Orbiting away from the home pose by delta moves the source by about D sin(delta) across the lens (15 degrees: about 0.65 thE), enough to turn an Einstein ring into arcs or a single weak image. A ring was only a ring at the home pose, which reads as lensing "sometimes looking wrong".

## Decision

1. `sourceOffset` (src/sim/lens.ts) returns the source's lens-frame offset `[bx, by]` whatever the camera. The source stays centred behind the lens as the user orbits, so a ring or an arc stays one. `lensView` is the only caller.
2. At the home pose this is `srcNow`'s result exactly (`rotFwd(rotInv(v, R), R) = v`), so the lens cases drawn at the home pose are unchanged (up to the last bit of f64 rounding before the f32 cast).
3. `srcNow` stays in src/view/camera.ts as v21's function (tests/vectors/camera.json); the lens no longer calls it. The explicit `LensHome` (ADR 0050) is still saved and still orients each source galaxy's marks, so only the source's centre is affected.
4. Tiers: the offset is a view-tier number (`LensView.bc`) and only becomes camera-independent; nothing in the model tier reads the camera, so a pure orbit still does not rebuild the lens model.

## Consequences

- Orbiting no longer moves the lensed images relative to the lens, except through the plate projection of the lens itself (the roll `pa`, zoom).
- Goldens: lens cases captured at the home pose do not shift. Cases whose camera differs from the home (an orbit applied) now differ from v21's capture; the oracle comparisons run at the home pose.
- Tests: tests/unit/lens-orbit.test.ts (offsets at 5, 15 and 30 degrees of orbit equal the home pose's; equal to `srcNow` at the home pose).

## Amendment: it is a choice, `lensLock`, and not the default

Locked, the lens did not respond to the camera at all: the owner found it "static drawings over everything" and remembered that it had once worked. It is now the parameter `lensLock`: 0 is v21's source fixed in 3D behind the lens (the default, the goldens', and the behaviour the owner remembers: orbiting slides the source across the lens, a ring breaks into arcs and then into separate images); 1 is this ADR's lock; 2 eases it, sliding the source at 0.35 of v21's rate, so a ring survives a small orbit and breaks over a large one (`lensEase`, src/sim/lens.ts). The page uses 2. `LensScene.ease` carries it (1, 0 or 0.35), so the model tier does not read the camera and the GPU and CPU twins are unchanged.
