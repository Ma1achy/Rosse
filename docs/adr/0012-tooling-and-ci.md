# 12. Tooling and CI: lint, typecheck, unit tests and WGSL validation on every push; goldens on a software GPU in CI

Date: 2026-10-03

## Status

Accepted

## Context

A golden-image test needs a browser with WebGPU. GitHub-hosted runners have no GPU. Chrome's WebGPU can run on **SwiftShader**, Google's CPU implementation of Vulkan. In this project's container we verified that headless Chromium 141 (the browser that Playwright 1.56 provides) exposes a WebGPU adapter with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`, when the page is served from `http://localhost` (WebGPU needs a secure context). It reports vendor `google` and architecture `swiftshader`. The reference page's WebGL also renders on SwiftShader.

The options considered for goldens were:

- a self-hosted GPU runner;
- a manual job run on a developer's machine;
- SwiftShader on hosted runners;
- no CI goldens at all.

## Decision

- **On every push and pull request** (`.github/workflows/ci.yml`): `npm ci`, `npm run lint` (ESLint and Prettier check), `npm run typecheck`, `npm test` (vitest), `npm run validate:wgsl` (naga, via `cargo install naga-cli`, cached), and `npm run build`.
- **Goldens on SwiftShader** (`.github/workflows/golden.yml`). This runs on pull requests that touch `src/`, `tests/golden/` or `tools/`, and on demand.
  - Checkout uses LFS, so the reference images come down.
  - It installs Playwright's Chromium and runs `npm run golden` against the committed reference captures.
  - It uploads the render diffs as an artifact.
  - From M2 it is a required check. Until then the job only checks that the reference captures are present and consistent with their manifest.
- **Goldens on a real GPU:** the same workflow with `workflow_dispatch` and a `runner` input. On a self-hosted runner labelled `gpu`, it runs with the hardware adapter and the L1 tolerances (ADR 0004). Until a runner exists, developers run `npm run golden -- --adapter hardware` locally and attach the report to their pull request (CONTRIBUTING.md).
- **Reference captures are regenerated only by hand** (`npm run capture:reference`), and only when the reference changes, which it shouldn't. `--verify` re-captures and checks every pixel hash against the manifest.

## Consequences

- SwiftShader is slow. A full golden run is a few minutes, and timings from it mean nothing. Performance work (M10) needs real hardware.
- SwiftShader is one particular conforming implementation. Passing on it proves L0 and the parity metric, not L1 on all GPUs. Hence the manual real-GPU job.
- Pinning matters. Playwright, and with it the Chromium build, is pinned in `package.json`, because a browser update can change SwiftShader's rounding and break bit-exact self-goldens. Bumping Playwright is a deliberate pull request that refreshes the engine's own goldens.
