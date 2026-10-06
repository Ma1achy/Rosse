**THROWAWAY SPIKE — not production code; delete freely once the WebGPU rewrite has settled how vector pen lines are drawn.** Findings are in [RESULTS.md](RESULTS.md).

Run headless: `node spikes/vector-lines/run.mjs` from the repo root (SwiftShader WebGPU via Playwright; writes `screenshots/` and `results.json`).
On real hardware: `npx serve` from the repo root, then open `/spikes/vector-lines/` in a WebGPU browser.
