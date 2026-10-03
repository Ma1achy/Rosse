# tools/capture-reference

Captures Rosse v21 as golden images into `tests/golden/reference/`. What it captures, why, and how the captures are made reproducible are described in `tests/golden/README.md`.

```sh
npm run capture:reference                       # all 186 captures, about 7 minutes on SwiftShader (4 pages in parallel)
npm run capture:reference -- --only "Ringed"    # a subset (comma-separated preset names)
npm run capture:reference -- --out /tmp/x       # elsewhere
npm run capture:reference -- --verify           # re-capture and compare pixel hashes with the manifest
```

It needs Playwright's Chromium. It uses the project's `playwright`, or falls back to a global install.
