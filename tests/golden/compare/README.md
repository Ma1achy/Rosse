# tests/golden/compare

`compare.mjs` is the entry point of `npm run golden`.

- **Today (M0):** it checks that the reference captures are complete and match their manifest.
- **From M2:** it renders each case with the new engine and applies the metric. The metric's functions (density map, SSIM, distance transform, stroke-width distribution) will live beside it as small, unit-tested modules.
