# src/shaders

WGSL, one concern per file. `common/` holds shared declarations, pulled into a shader with a line `// #import "common/rng.wgsl"` (paths relative to this folder). `compute/` holds compute passes, `render/` vertex and fragment stages. Every file must validate with naga once its imports are resolved: `npm run validate:wgsl`. See docs/adr/0002-stack-and-build.md.
