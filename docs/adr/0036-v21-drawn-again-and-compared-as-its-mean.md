# 36. v21 drawn again, and compared as its mean, for the cases that need it

Date: 2026-10-07

## Status

Proposed. Awaiting the owner's sign-off. It records the owner's decision of 2026-10-07 (option 1, below) and changes how three cases are compared; it changes no threshold, and edits no Accepted ADR. It extends [0018](0018-comparison-draws-and-the-mean-of-k-redraws.md) to v21's side, and is used with [0035](0035-m7-calibration-with-the-stars-on-and-the-dots-count-spread.md) (calibration factor 2).

## Context

ADR 0018 compares one v21 capture with the mean of K engine draws. The capture is one draw of v21's stipple, with the noise of one draw, which no number of engine draws averages away. At the calibration factor the owner chose (2), three of the 212 required cases of the M7 branch failed, each by a measure that is v21's own single draw's:

| case | measure | value | band |
| --- | --- | --- | --- |
| `cigar-shaped--stipple` s4242 orbit | position angle | 5.37° | ±5.01° |
| `ringed--vectors` s7 zoom | inner axis ratio | 0.0386 | ±0.0340 |
| `layered-barred-spiral-satellite-trail--layered` s7 zoom | r50 | 3.19% | ±2.50% |

The widen-only rule of ADR 0026 does not reach them: 1.5 × the largest re-draw spread of each preset (2.42%, 0.0252 and 3.2°) is not wider than the band the case already has, because the engine's re-draws are not where the difference comes from. It is v21's draw: v21 drawn again for the third case has 8,341 to 8,987 dots in its other seven draws against the capture's 8,011.

## Decision

1. **v21 is drawn again for the listed cases** (tests/golden/v21-redraws.json): `npm run capture:reference -- --redraws tests/golden/v21-redraws.json` captures draws 1 to N − 1 (N = 8) of the stipple of each, the existing capture being draw 0. Only the one stream `generate()` draws the marks from (`mulberry32(P.seed · 9973 + 1)`, app23.js) is moved, by k · 1,000,003, in a copy of the page served for the purpose: the variation, the strokes, the dust, the parts, the stars' picks and the sky are the capture's own, as the engine's placement key re-draws the marks and nothing else. The tool's own `--reroll` (a 0.3° orbit) was tried first and does not do this: it re-rolls the stipple in v21 only partly, as docs/reference-notes.md says, and most counts do not change.
2. **The case is compared with the mean of v21's draws**: every measure is the mean over v21's N draws and the engine's K draws of the comparison of one with the other (the mean over the engine's K draws, ADR 0018, of the mean over v21's N), and v21's counts are the mean of its draws' counts. A case with no listed draws is compared with its one capture, as ever. The draws are committed under tests/golden/reference (`<name>__v21d<k>`), recorded under `v21Draws` in the manifest, checked for integrity with the captures, and the mechanism is the same for any case: a name in the list.
3. **The bands are not changed**: nothing is widened, by rule or by hand, and the factor stays 2.
4. **The same mechanism is for M12's `Real galaxy 6`** (its r50 miss), when that milestone's cases are in.

## Consequences

- The three cases pass with the bands they had: the position angle difference 5.37° becomes 1.06° (±5.01°), the inner axis ratio 0.0386 becomes 0.0112 (±0.0340) and r50 3.19% becomes 1.52% (±2.50%). v21's draws agree with the engine's mean where its one capture did not.
- The negative controls are untouched: they compare re-draws of the engine with each other, so the v21 draws change nothing in the calibration or in which controls are caught. Re-run from the same shards with the same thresholds: 172 of 303 applicable (control, configuration) pairs before and after, with the same pairs.
- The cost is 7 further captures of v21 per listed case (about two minutes in all) and, per listed case, 8 comparisons per engine draw instead of one.
- The captures are on SwiftShader; the owner re-checks this with the rest of the calibration on real hardware (docs/open-questions.md Q14).
- A case compared with the mean is a weaker test of v21's own draw-to-draw variation by construction, and a stronger one of the engine's mean; the list is therefore kept short and each name needs a reason in this ADR or its successor.
