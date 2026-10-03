# M1: paper and one mark

The plate on Paper and on Chalkboard, with one dot at the centre (dots cell 0, sized by v21's `dotSprite` at pen 2.4: an 11.4-unit quad, a dot about 2.2 px across) and a few more marks from the dots, knots, stars, cores and pieces sheets. Taken with `npm run screenshots -- docs/milestones/m1 --crop 120` on Chromium with WebGPU on SwiftShader, at DPR 1.

| | WebGPU | CPU engine |
| --- | --- | --- |
| Paper | `plate-paper-webgpu.jpg` | `plate-paper-cpu.jpg` |
| Chalkboard | `plate-chalk-webgpu.jpg` | `plate-chalk-cpu.jpg` |
| centre, 4× | `plate-*-webgpu-centre.jpg` | `plate-*-cpu-centre.jpg` |

The surfaces are v21's: on Paper, the field `#e6dece` with the paper texture in `multiply` (mean about (222, 214, 199)) and a 1 px inset rim; on Chalkboard, `#262b28` with the texture in `soft-light`, a darker rim and a 60 px inset vignette. `npm run test:gpu` compares the composite with screenshots of v21's own empty plate.

## Measured (`npm run test:gpu`, SwiftShader)

- **RNG vectors:** 256 keys. pcg4d, u32 and uniform bits are identical on the GPU. The Gaussian is within 1.9e-4 (WGSL's `cos` bound allows 2.7e-3).
- **One mark**, CPU raster against GPU raster, same instances:
  - ink target: max difference 0.015/255 (one dot, DPR 1), and 0.097/255 at worst (sample scene, DPR 1). This is the rgba16float rounding.
  - composited RGBA8: at most 1/255 (rounding).
  - orientation and cell mapping: a synthetic L-shaped cell, upright and turned a quarter by `simple(32, π/2)`, inks exactly the expected probe pixels on both engines (10/10).
- **Surface against v21's plate** (the real page, everything but the plate hidden):
  - Paper: max 2/255, only at the rim; 0/255 elsewhere at DPR 1.
  - Chalkboard: max 1/255 at DPR 1 and 2/255 at DPR 2. Chromium approximates the vignette's Gaussian; ours is analytic (erf).
  - The means agree to 0.03 levels.
- **The dot against v21:** QA measured the centre dot's total ink within 1% of v21's for the same cell and size.

**Real hardware.** The 1/255 CPU = GPU tolerance is proven on SwiftShader only. Real GPUs filter 8-bit textures with limited sub-texel precision, and through the smoothstep ink edge (slope up to about 3.5) that could reach about 3.5/255. It is to be measured on real adapters in M10.
