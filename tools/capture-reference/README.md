# tools/capture-reference

Captures Rosse v21 as golden images into `tests/golden/reference/`. What it captures, why, and how the captures are made reproducible are described in `tests/golden/README.md`.

```sh
npm run capture:reference                       # all 186 captures, about 7 minutes on SwiftShader (4 pages in parallel)
npm run capture:reference -- --only "Ringed"    # a subset (comma-separated preset names)
npm run capture:reference -- --out /tmp/x       # elsewhere
npm run capture:reference -- --verify           # re-capture and compare pixel hashes with the manifest
```

It needs Playwright's Chromium. It uses the project's `playwright`, or falls back to a global install.

## Real galaxies, `fromVotes` and the SVG export (M12)

```sh
npm run capture:reference -- --extra tests/golden/extra-cases.json --variants real   # 10 real galaxies, home and orbit
node tools/capture-reference/votes.mjs                                               # fromVotes' outputs, from v21 itself
node tools/capture-reference/svg.mjs                                                 # v21's exportSVG counts for five presets
npx prettier --write tests/vectors/from-votes.json tests/vectors/svg-v21.json
```

- **`"real": i` in an `--extra` case** captures one of the 42 real galaxies as v21 draws it from its votes (`__GEN.real(i)`, v21's `showReal`) instead of a preset: `preset` is only its name (`Real galaxy 12`), `seeds` must hold the one seed `fromVotes` gives it (the capture fails if the page's differs), and the overrides are set after it. Names are `real-galaxy-12--real__s6057__home`, and the manifest entries carry `real`. `--variants real` selects them.
- **`votes.mjs`** serves a copy of the reference page with one line added after its `window.__EXPORT` hook, which hands `fromVotes`, `fromReal`, `describe`, `shortType`, `DEF`, `REAL`, `TYPES`, `catVotes`, `catExtra` and `loadCat` to the script (`window.__FV`). It records `fromReal` for all 42 real galaxies, `fromVotes` for 339 catalogue rows (every type of v21's buttons, the star-or-artefact rows, rows with measurements missing, an even spread), and 12 of those again through v21's own `showCat` (`__GEN.find(objid)`), whose parameters and caption must equal the replica's. The reference page on disk is not touched.
- **`svg.mjs`** runs the page's `__EXPORT()` and records the elements per layer for five presets (the golden `single` overrides, seed 7), for `tests/unit/svg.test.ts`. `--save-svgs dir` also writes the files.
