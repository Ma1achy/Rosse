# 92. The core is drawn behind the disc

Date: 2026-10-10

## Status

Proposed. Opt-in (`coreAuto`, 0 in the core so v21's goldens hold, 1 on the page). A deliberate divergence from v21, requested by the owner. It amends [0079](0079-the-core-is-one-opaque-drawing.md) for the page.

## Context

The drawn core (the bitmap at the centre: a dark ball or a spiral) is a billboard. v21 composites it last, so it lies over every star, dust stroke and hatch; ADR 0079 made it fully opaque. Seen face-on and zoomed, a large solid shape sits over the whole inner disc as if it were the nearest thing in the picture, though the bulge is the thing the disc's marks lie in front of.

The ink is composited premultiplied over, so a mark drawn over solid ink is invisible: there is no way to show "in front" except a core that is not solid and is drawn first.

## Decision

With `coreAuto`:

1. The core and the nuclear spiral are the first layers of the galaxy, after the sky's background (both engines; a merger's tide-carried core too). Every star, stroke and dust mark of the disc is drawn over them.
2. Their alpha is `CORE_BEHIND_ALPHA` = 0.5 (`coreAlpha`, src/model/parts.ts), so the marks over the core stay readable and the core reads as a haze under them.

Without it nothing changes.

## Not done

- No per-mark depth: marks behind the bulge's midplane are drawn over the core as well. A real ordering needs the marks split by depth into layers before and after the core, or a depth buffer for the ink.
- The bulge's own stars and strokes (a denser, better-shaped stippled bulge, so the bitmap is only flavour) are a follow-up.

## Consequences

- The page's core is lighter and the inner disc is legible under it. Core goldens are unchanged. GPU and CPU take the same layer order.
