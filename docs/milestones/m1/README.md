# M1: paper and one mark

The plate on Paper and on Chalkboard, with one dot at the centre (dots cell 0, sized by v21's `dotSprite` at pen 2.4: an 11.4-unit quad, a dot about 2.2 px across) and a few more marks from the dots, knots, stars, cores and pieces sheets. Taken with `npm run screenshots -- docs/milestones/m1 --crop 120` on Chromium with WebGPU on SwiftShader, at DPR 1.

| | WebGPU | CPU engine |
| --- | --- | --- |
| Paper | `plate-paper-webgpu.jpg` | `plate-paper-cpu.jpg` |
| Chalkboard | `plate-chalk-webgpu.jpg` | `plate-chalk-cpu.jpg` |
| centre, 4× | `plate-*-webgpu-centre.jpg` | `plate-*-cpu-centre.jpg` |

The Paper surface is nearly white because v21's is: `#e6dece` with the paper texture in `overlay`. `npm run test:gpu` checks the composite against Chromium's own rendering of that CSS, and it matches exactly at DPR 1.

## Measured (`npm run test:gpu`, SwiftShader)

- RNG vectors: 256 keys, pcg4d, u32 and uniform bits identical on the GPU; Gaussian within 1.9e-4 (WGSL's `cos` bound allows 2.7e-3).
- One mark, CPU raster against GPU raster, same instances:
  - ink target: max difference 0.015/255 (one dot, DPR 1), 0.097/255 at worst (sample scene, DPR 1), which is the rgba16float rounding;
  - composited RGBA8: identical for the one dot at DPR 1, at most 1/255 elsewhere (rounding).
- Surface: composite against the reference CSS, max 0/255 on the GPU at DPR 1 and 2, and 1/255 on the CPU at DPR 2.
