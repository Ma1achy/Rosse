# 2. TypeScript, Vite and WGSL files with a small import resolver

Date: 2026-10-03

## Status

Accepted

## Context

The reference is about 1,900 lines of untyped ES5 in one closure, with mutable globals (`P`, `VAR`, `VIEW`, `SM`) swapped in and out during a render (app23.js:L631–643, L1246–1256). The new engine has many GPU buffers whose layouts must agree between TypeScript and WGSL. Errors in those layouts are silent: wrong strides give garbage rather than exceptions.

The options considered for the build were Vite, esbuild alone, webpack, or no bundler (native ES modules).

The options considered for WGSL were:

- inline template strings in TypeScript;
- `.wgsl` files with no composition;
- `.wgsl` files with a tiny `#import` resolver;
- a full shader toolkit (WESL/wesl-js, or TypeGPU, which writes shaders in TypeScript; see ADR 0014).

## Decision

- **TypeScript in strict mode**, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Vite** for dev server and build, **vitest** for unit tests (they share Vite's config and transforms), **ESLint** (flat config, typescript-eslint strict and type-checked) and **Prettier**. Vite is the default for this kind of project, starts instantly, serves `assets/` without copying, and handles workers and WASM if we need them later. esbuild alone would need a dev server and a test runner bolted on. Webpack is heavier for no gain here.
- **WGSL in its own files** under `src/shaders/` (`common/`, `compute/`, `render/`), one concern per file. They are imported as strings (`import src from './x.wgsl'`) through a 40-line Vite plugin (`tools/vite-wgsl.js`). The plugin resolves lines of the form `// #import "common/rng.wgsl"`, and the result is still valid WGSL, so editors and validators see ordinary WGSL. Each file is included at most once, and cycles are an error.
- **The same resolver** (`tools/wgsl-resolve.js`) feeds the CI validator, which runs **naga** (`naga-cli`) on every resolved shader. What CI validates is exactly what the browser compiles. In the browser, `getCompilationInfo` messages are surfaced in development, and the golden job compiles every pipeline on Chrome's own compiler (Tint), so both naga and Tint check every shader.

## Consequences

- No WGSL preprocessor features beyond imports: no macros or conditionals. Variants are made with WGSL `override` constants and separate entry points.
- Struct layouts are defined twice, once in WGSL and once in TS. A unit test per struct (from M1) checks sizes and offsets against the WGSL declaration parsed with `wgsl_reflect`.
- naga and Tint occasionally disagree on edge cases. A shader must pass both.
- Contributors need Node 22 and, to validate shaders locally, `cargo install naga-cli`. CI caches it.
