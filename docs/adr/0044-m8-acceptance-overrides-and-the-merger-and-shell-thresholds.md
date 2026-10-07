# 44. The M8 goldens: their overrides, and the thresholds of the merger and shell families

Date: 2026-10-07

## Status

Proposed, awaiting the owner's sign-off. Follows [0016](0016-m2-acceptance-overrides.md) and [0022](0022-m5-acceptance-overrides.md) (both proposed) for the overrides, and applies [0018](0018-comparison-draws-and-the-mean-of-k-redraws.md) (proposed) to two new families. It changes none of them.

## Context

The roadmap's M8 acceptance is goldens for the eight `Merger: …` presets and `Sketches, torn apart`, with the test stars' drift measured. Three things have to be settled before those goldens mean anything.

1. **What v21 draws that M8 does not.** The merged picture in v21 also draws drawn stars among the debris (`starMix`, vector `sstars`, M7), the deep field and foreground stars (the sky, M7), and, for `Layered: lensed merger`, the lens (M9).
2. **Thresholds.** The merger family had only the placeholders of ADR 0015 (`provisional`: coarse SSIM ≥ 0.85, every radius ±10%). Against them 29 of the 72 merger captures failed, 28 of them on coarse SSIM alone (0.79–0.85), with ink, widths, counts and the moments inside their bands. A galaxy merger is chaotic: its tails and remnant are one random realisation, and v21's single draw is not the engine's mean of K draws.
3. **The simulated shells.** `Shell galaxy` with `shellsOn` draws a satellite's 6,000 stars as dots and its detected shells as arcs. The satellite's stars are v21's own random draw on its own stream, which the engine's placement key re-draws; the arcs are a detection on that draw (ADR 0043).

## Decision

**1. The overrides of the M8 captures** (`tests/golden/extra-cases.json`, variants `mergers`, `mergers-t05`, `mergers-t15` and `shells`):

- `starMix: 0`, `field: 0`, `fgstars: 0`, as ADR 0016 and ADR 0022 do. The drawn stars of the debris and of the galaxies' clumps are classified and counted (`rstars`) and drawn from M7.
- `lensOn: 0` on `Layered: lensed merger`: the lens is M9. That preset is M9's acceptance; here it is drawn as a merger, and its M8 captures are regression cases until M9.
- `mergers-t05` and `mergers-t15` are the Mice at `mTime` 0.5 (on the way in, snapshots blended) and 1.5 (on the way out, horizon 2): the timeline's other moments.
- `shells` is `Shell galaxy` as the preset has it (`shellsOn` 1), at seeds 7 and 4242, home, orbit and zoom, and held-out seeds 3, 11, 23 and 101 for the calibration only.

Nothing else is overridden: the galaxies' ribbons, dust and hatching, the vector parts, `mWarp` and the debris are all on.

**2. The comparison draws with v21's discrete choices** (ADR 0018, item 1), now also for mergers and shells:

- each merging galaxy's spin azimuth and pitch, its `mergerGalaxyParams` draws, its variation, stroke picks, noise corners and part picks (`compare/v21-merger.ts`, from v21's own `simulateMerger`);
- `mWarp`'s two whole drawings (`mulberry32(seed · 211 + 7)`);
- the shells' stroke rows, and **the shells v21 found** (`SceneOptions.shells.arcs`, from v21's own `shellSprites` on the seed, `compare/v21-shells.ts`). Which shells exist is structure: the engine's detection finds the same ones from the same start (tests/unit/shells.test.ts, tests/gpu/shells.ts), but from its own draw of the satellite it finds 4 or 5 where v21 has 4 or 6.

The test stars' initial conditions, and the marks, are the engine's own and are re-keyed by the placement key (tests/unit/merger-distribution.test.ts checks them against v21's by Kolmogorov–Smirnov).

**3. The merger family** (`merger`, and `merger@zoom` for the zoom camera) is calibrated by ADR 0018's rule: 72 configurations (the ten presets' captures, the Mice's two other moments), K = 6, three stand-ins each, and the negative controls on every one. Coarse SSIM is the 5th percentile of the re-draw spread minus 0.02, ink and widths keep their floors, the moments are 1.5 × the 95th percentile, and the axis ratios are per preset. Two additions, which are what this ADR proposes:

- **The moment tolerances are no smaller than 1.1 × the largest of the family's own re-draw pairs** (median and p90 widths, r25, r50, r90, outer ink). This is the rule ADR 0018 item 7 applies to held-out captures, for the same reason: the tails are heavy. With the 1.5 × p95 rule alone, `Layered: lensed merger` at seed 4242 failed r25 by 0.35 points (−6.35% against ±6.00%, home and orbit) while its own re-draws never reached that, and 2 of the 72 cases at the edge of a 1.5 × p95 band is what a heavy-tailed measure gives. The cost is in the controls (below): `stage +0.7` is caught in 45 of 48 configurations instead of 46, `stage −0.7` in 47 instead of 48.
- **A merger preset's coarse SSIM floor is its own where lower** (`byPreset.ssimCoarse`, only ever below the family's). `Merger: coalescing` is a remnant of stars on tight orbits round a merged pair: two engine draws agree with each other at a coarse SSIM of 0.79–0.82 (mean 0.81, against 0.85–0.88 for the other presets), and v21 against the engine's mean sits at 0.787–0.808, inside that spread. Its floor is 0.77 against the family's 0.79. The rule is the family's, applied to the preset's own 18 pairs.

| | ink | coarse SSIM | median | p90 | r25 | r50 | r90 | outer | q | q inner | paA | paε₀ |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `merger` | ±5% | ≥ 0.79 | ±10% | ±10% | ±7.8% | ±7.8% | ±8.3% | ±3.5 pts | ±0.058 | ±0.059 | 2.114° | 0.072 |
| `merger@zoom` | ±6% | ≥ 0.77 | ±10% | ±10% | ±9.6% | ±5.7% | ±6.6% | ±2.8 pts | ±0.073 | ±0.090 | 1.684° | 0.093 |

Per-preset axis-ratio tolerances (`byPreset`) are in thresholds.json. Counts are ADR 0015's (±3%, ±10% under 100, 3 √(v21 + engine) below 2,000).

**4. The shell family** (`shells`, `shells@zoom`) is calibrated like the line-work (ADR 0018 item 7): the engine's re-draws barely differ (the satellite's 6,000 dots are a quiet part of the picture), so the rule alone would gate v21 on the renderer's own differences. Seeds 3, 11, 23 and 101 of `Shell galaxy` at home, orbit and zoom are captured from v21 for the calibration only (12 captures, `"calibration": true`), the same rule is applied to v21 against the engine's K draws there, and each threshold is the wider of the two. `Shell galaxy`'s captures with `shellsOn` leave the `smooth` family for it.

## Consequences

- The thresholds of the merger and shell families are measured, not provisional: `thresholds.json` no longer marks `merger` provisional. `lens`, `star` and `artefact` still are.
- **Controls (`calibration.json`).** `merger`: `pa ±30°` 45 of 45 each, `pa +90°` 48 of 48, `stage +0.7` 45 of 48, `stage −0.7` 47 of 48, `mass ratio` 40 of 44, `closest approach +0.8` 48 of 48, `timeline 0.5` 40 of 40, `dot size ×1.3` 48 of 48, `orbit 35°` 45 of 45. `merger@zoom`: 24 of 24 or 20 of 20 for each, except `stage +0.7` 23 of 24 and `mass ratio` 21 of 22. The missed controls are listed by configuration in `calibration.json` (`missed`): `stage ±0.7` on `Merger: coalescing`, and the mass ratio on the Mice and the dry merger.
- **Shells.** The controls that need a visible structure are caught (`pa +90°` 12 of 12, `bulgeFlat ±0.15` 12 of 12, `dot size ×1.3` 12 of 12, `RMAX 4.2` 9 of 12); a near-round elliptical hides a ±30° position angle (4 and 6 of 12), `halo off` is not caught (0 of 12), and an orbit changes nothing in a Sérsic image, because v21 draws it in two dimensions turned by `pa` only (Q13, reference notes 20.14). These are the limits ADR 0015 already states for the smooth family.
- If the owner rejects the largest-pair floor, the merger thresholds fall back to the 1.5 × p95 values (`r25` ±6.0%, `r50` ±5.0%, `r90` ±6.8%, `outer` ±2.7%, `ssimCoarse` ≥ 0.79), and the two `Layered: lensed merger` cases fail by 0.35 points of r25. That preset is M9's.
- The golden set grows by 78 required cases (72 mergers, 6 shells) and 12 held-out captures.
