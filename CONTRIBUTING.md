# Contributing

## Branches and commits

- Work on **short-lived feature branches** from `main`, named `<type>/<short-description>` (for example `feat/stipple-sampler`). Merge within days, not weeks.
- Use **[Conventional Commits](https://www.conventionalcommits.org/)**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, `chore:`, with an optional scope (`feat(lens): …`). Write in British English.
- Keep `main` green. Every pull request must pass CI (lint, typecheck, tests, WGSL validation, build) and, from M2, the golden check.

## Pull requests

- One milestone step per pull request, small enough to review in one sitting.
- **Attach a render diff** for anything that changes what is drawn: the golden report from `tests/golden/diff/` (CI uploads it as an artifact), or before and after screenshots for UI work.
- If you change a recorded decision, add an ADR that supersedes it (docs/adr/0001).
- A compute kernel change touches both its WGSL file and its CPU twin, and their parity test (ADR 0014).
- If you ran goldens on real hardware (`npm run golden -- --adapter hardware`, from M2), say which GPU, browser and driver.
- Update `CHANGELOG.md` under "Unreleased".

## Code

- TypeScript is strict. Prefer plain data and pure functions in `core/`, `model/`, `view/` and `sim/`. GPU objects live only in `gpu/`, `render/` and `marks/`.
- WGSL goes in `src/shaders/`, one concern per file. Share code with `// #import "common/…"`. Every file must pass `npm run validate:wgsl`.
- Randomness only comes from the counter-based RNG (ADR 0004): no `Math.random`, no order-dependent atomics.
- Formatting is Prettier's. Run `npm run format`.

## Tooling notes

- The lockfile was generated with npm 11. npm 10.9 hits an internal error (`edgesOut`) resolving this tree from scratch, but `npm ci` from the lockfile works on either. To change dependencies, use `npx npm@11 install …`.
- Binaries under `tests/golden/` and `spikes/` are in Git LFS. Run `git lfs install` before cloning.
