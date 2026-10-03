# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project will use [Semantic Versioning](https://semver.org/spec/v2.0.0.html) from its first release.

## [Unreleased]

### Added

- M0 planning: reference notes for Rosse v21, the architecture and ADRs 0001–0014, the roadmap and open questions.
- Repository skeleton: TypeScript, Vite, vitest, ESLint, Prettier, WGSL files with an import resolver and naga validation, and CI workflows.
- `tools/capture-reference`: 186 golden captures of v21 (45 presets × 2 seeds × 2 cameras, plus Chalkboard).
- `tools/profile-reference`: timings and sizes of v21's stages.
- `spikes/vector-lines`: GPU pen ribbons compared with distance fields.

### Removed

- The duplicate `rosse-v21.html` at the repository root (identical to `assets/reference/pages/rosse-v21.html`).
