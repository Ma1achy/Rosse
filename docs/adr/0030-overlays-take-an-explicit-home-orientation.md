# 30. Overlays take an explicit home orientation

Date: 2026-10-06

## Status

Accepted. This is open question Q3, option (b), as the roadmap and [0008](0008-lens-solver-on-the-gpu.md) propose and the owner's brief for M7 asks. It is deliberate divergence 2 of docs/architecture.md, now built for overlays (M9 builds it for lensed sources).

## Context

An overlay is a bright foreground star and an artefact (a satellite trail, a ghost reflection, cosmic rays) laid over any subject: `ovStar`, `ovStarD`, `ovStarA` and `ovArtefact` (`overlaySprites`, app23.js:L453–465). The star "a little in front of the galaxy" is placed at an offset of `ovStarD` galaxy units in direction `ovStarA`, at depth 1.4, and the ghost's star at 1.1 units and depth 1.4; the camera then moves round them, as it moves round the galaxy.

v21 does this with hidden state. `scenePoint` (L446) places a point "as the camera sees it now" relative to the orientation the overlay was *first placed at*, which `homeFor` (L445) remembers in a global (`OVHOME`) keyed by `[seed, ovStar > 0.02, ovStarD, ovStarA, ovArtefact]`. The same parameters therefore render differently depending on navigation history: orbit first and then switch an overlay on, and the overlay is fixed in the scene at the orbited view; reload the page at the same parameters and it is fixed at that view instead. A golden test, a shared link and a second render of the same drawing cannot reproduce it (docs/open-questions.md Q3; `INCL_CONTINUOUS`, L442 in src/view/camera.ts).

The reference captures show it: `tools/capture-reference/capture.mjs` reloads the page for every (preset, seed) and captures the home view first, so that the orbit view moves the camera round overlays placed at home.

## Decision

1. **The home orientation is an explicit parameter of the scene**: `SceneOptions.home` (`{ incl, az, w, pa }`, v21's `orientNow()`), stored as `GalaxyScene.home`. An overlay's position is a pure function of the parameters, the home and the camera: `scenePoint(home, sx, sy, depth, camera)` (src/view/camera.ts, which already had v21's arithmetic, in f64). A render depends on nothing else.
2. **The default is the camera of the parameters the scene is built from.** That pins an overlay to the plate: it is where v21 draws it when the camera has not moved since the overlay was placed, and an orbit then shows no parallax. A page that orbits passes the orientation of the preset it started from, so that the camera moves round the overlay:
   - src/main.ts keeps `home` with the parameters wanted: a new preset is placed at its own orientation, which becomes the home; a new seed re-homes at the camera it keeps (v21 re-homes when the seed changes, because the seed is in `homeFor`'s key); an orbit, a roll or a zoom leave it alone.
   - the golden runner (tests/golden/compare/node.ts `referenceOptions`) passes the preset's own orientation as the home of every capture, which is where v21's captures place their overlays (the home camera is captured first); the orbit and zoom captures then move the camera round them.
3. **The trail stays on the image**, as v21's does in effect and its comment says it intends ("a satellite near Earth doesn't turn with the galaxy", L461, open question Q12): the overlay trail and cosmic rays are placed at the plate's centre, not in the scene. Only the overlay star and the overlay ghost's star are scene points.
4. **The home is part of the model tier's key** (`modelKey` of `GpuStipple.frame` and `CpuStippleTiers.frame` is the JSON of the scene options), so a new home rebuilds the scene description, which is a few kilobytes. An orbit does not: the camera is a view input and the stars' centres are re-placed each view (`starJobs`, src/model/stars.ts), a few records.

## Consequences

- Renders are pure functions of parameters, home and camera; the golden cases (`Layered: …`) and a shared link reproduce.
- A saved drawing has to save its home with its parameters (M11's URL state; src/ui/url.ts has the camera, and `home` joins it).
- A scene seen from a camera that equals its home is pixel-identical to the same scene seen with no home given, so every non-orbiting capture is unaffected.
- The lens (M9) and the merger's framing use `srcNow` and `homeFor` the same way; M9 reads `SceneOptions.home` for its source orientation.
