# tests/golden/compare

The golden comparison of ADR 0013 (`npm run golden`; see ../README.md).

- `compare.mjs`: the entry point. Checks the reference captures against their manifest, starts Vite, renders every required case on WebGPU (Chromium on SwiftShader, `../render.html` → `render-gpu.ts`) and on the CPU engine (`engine-cpu.ts`, loaded in Node through Vite's SSR loader), and applies the metric. `--calibrate` writes `../thresholds.json` and `../calibration.json`.
- `metrics.ts`: total ink, density maps, SSIM, the distance transform and stroke widths. Unit-tested in `tests/unit/golden-metrics.test.ts`.
- `thresholds.ts`: thresholds and the pass/fail decision of one case.
- `report.ts`: the HTML report written to `../diff/` (not committed).
- `node.ts`: the Node half (reading captures, the CPU engine, reports, calibration).
