# Rosse

A galaxy-drawing engine. Every mark it draws comes from a library of real hand drawings: dots, strokes, knots, stars and whole galaxies, drawn with a fineliner, scanned and cut out. Rosse builds each galaxy in 3D, then places, transforms and inks those drawings on paper.

This repository is the WebGPU rebuild of Rosse v21. **Status: M0 (planning).** It holds the plan, the repository skeleton, the reference captures and a spike. There is no engine code yet; see [docs/roadmap.md](docs/roadmap.md).

## Quick start

You need Node 22 or later. To validate shaders, you also need [naga](https://crates.io/crates/naga-cli) (`cargo install naga-cli`).

```sh
npm ci
npm run dev                # Vite dev server (an empty plate, for now)
npm test                   # unit tests (vitest)
npm run lint               # ESLint + Prettier check
npm run typecheck          # tsc, strict
npm run validate:wgsl      # every shader through naga, imports resolved
npm run build              # production build into dist/
npm run golden             # golden check (M0: reference captures intact)
npm run capture:reference  # re-capture v21 into tests/golden/reference (rarely needed)
npm run profile:reference  # time and count v21's stages → docs/data/reference-profile.json
npm run spike              # the vector-lines spike: screenshots and timings
```

The tools that drive a browser use Playwright's Chromium (`npx playwright install chromium`) with software rendering, so they need no GPU.

## Where things are

|  |  |
| --- | --- |
| `assets/` | the asset pack: drawings, objects, fonts, data, and the reference (v21 page and source). Read `assets/README.md`. |
| `docs/reference-notes.md` | how v21 works, stage by stage, with sizes and costs |
| `docs/architecture.md` | the WebGPU design, with ADRs in `docs/adr/` |
| `docs/roadmap.md` | milestones M1–M11 to parity |
| `docs/open-questions.md` | decisions waiting for the owner |
| `src/` | the engine skeleton: `core`, `model`, `view`, `sim`, `marks`, `gpu`, `render`, `shaders`, `fallback`, `ui` |
| `tests/` | unit tests, and golden images of v21 with their harness |
| `tools/` | reference capture and profiling, WGSL resolver and validator, asset preparation |
| `spikes/` | throwaway experiments; `vector-lines` decided how pen lines are drawn |

## Licence

To be decided; see `LICENSE` and docs/open-questions.md (Q1).
