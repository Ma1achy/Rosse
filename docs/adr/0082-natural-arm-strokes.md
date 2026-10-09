# 82. Natural arm strokes

Date: 2026-10-09

## Status

Proposed. A deliberate divergence from v21, requested by the owner, on the page only.

## Context

Each spiral arm is one pen line of one width. The owner asked for more brush and line strokes, so that arms read as voluminous, with a width that follows the structure: broad where an arm leaves the bar or bulge, fine toward its tip, and varying from arm to arm.

## Decision

A model-tier parameter `strokesAuto` ("Natural arm strokes", 0 in the core). With it on, each ribbon arm also gets companion strokes (`armFibres`, role `arm-fibre`, src/model/curves.ts): one broad root stroke over the first third of the arm, and 2 to 6 strokes of 22 to 62% of its length, offset sideways by a few percent of the radius, with a small z jitter, and a width that falls from the root to the tip. Each arm has its own body width (0.6 to 1.5), so some are fine and some broad. The draws are counter-indexed (`CurveIndex.armFibre`), so adding strokes moves no other draw. They are ordinary ribbons: no kernel changes, CPU and GPU alike.

## Consequences

- Arms look thicker and more drawn; v21's arms (`strokesAuto` 0) and the goldens are unchanged.
- Not yet shaped: a width profile along a single stroke (it needs the ribbon description to carry one), and the same structural logic for the star density, which are the next steps.
