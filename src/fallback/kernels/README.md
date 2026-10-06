# src/fallback/kernels

TypeScript twins of the WGSL compute passes in `src/shaders/compute/`: one file per kernel, same names, same per-element functions, f32 arithmetic through `Math.fround`. Each pair has a parity test (ADR 0014). Empty until M1.
