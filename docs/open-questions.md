# Open questions

These are decisions for the owner. Each has options and a recommendation. Answers become ADRs, or confirm the proposed ones.

### Q1. Licence

The repository has a placeholder `LICENSE`. The code, the drawings and the fonts are different things:

- the fonts have their own licences, including the IBM Plex OFL included in the pack, and the Threshold and Heros kit terms;
- the photographed objects, the Galaxy Zoo 2 data and the SDSS photos have theirs.

Options:

- (a) all rights reserved for everything;
- (b) an open-source licence (MIT or Apache-2.0) for the code, with the drawings all rights reserved or CC BY-NC 4.0, and third-party assets under their own terms, listed in `assets/LICENCES.md`;
- (c) open everything you own.

**Recommendation:** (b), with MIT for the code, the drawings all rights reserved until you decide otherwise, and a `NOTICE` listing third-party terms. Galaxy Zoo 2 is CC BY 4.0 (it needs attribution), and SDSS imagery needs its acknowledgement.

**Owner's decision of 2026-10-07 (the fonts only):** the Threshold fonts (Grain, Mark, Patina, Signs; loaded as "Principia Hand") are the owner's own handwriting and are unrestricted. The other fonts get their licences listed, as the pack gives them, in [assets/LICENCES.md](../assets/LICENCES.md): IBM Plex Mono is under the SIL OFL 1.1 (the pack includes the text); the pack includes no licence file for Heros, whose files name TeX Gyre Heros under the GUST Font License (not yet checked against that licence's conditions). The project's own licence, the photographed objects and the data are still undecided or unrecorded.

### Q2. Orbiting: keep v21's re-roll, or keep the marks?

In v21, with dust lanes on (the default), turning the camera even 0.3° re-draws every dot (reference notes, flagged item 1).

- (a) Reproduce it.
- (b) Keep marks fixed in 3D, so orbiting only moves them.

**Recommendation:** (b). It is what the design intends ("everything is drawn back to front, so nothing pops", app23.js:L855). It makes orbiting smooth, and it is free with counter-based RNG (ADR 0004).

### Q3. The home orientation of lensed sources and overlays

v21 fixes them in 3D at the camera seen _the first time_ a lens or overlay key appears, so the same parameters render differently depending on navigation history.

- (a) Reproduce the hidden history.
- (b) Make it an explicit parameter, set when a preset is chosen and saved with the drawing.
- (c) Always use a fixed home (the preset's own view).

**Recommendation:** (b). Renders become pure functions of parameters, which golden tests and sharing links need.

### Q4. Kernels for two backends (ADR 0014)

- (a) Hand-written WGSL plus TypeScript twins, with parity tests.
- (b) TypeGPU as a single source (TS compiled to WGSL and run on the CPU).
- (c) Decide after M1's evaluation.

**Recommendation:** (c), defaulting to (a). The brief asks for WGSL in its own files, and (a) keeps that. (b) is attractive only if it proves f32-exact on the CPU.

**M1 evaluation** ([notes/typegpu-evaluation.md](notes/typegpu-evaluation.md)): it does not. TypeGPU's generated WGSL is clean, but its CPU execution does u32 and f32 arithmetic in doubles (the RNG was wrong on 1,000 of 1,000 keys). The recommendation is now (a).

### Q5. What "CPU-only fallback" includes

- (a) Kernels on the CPU, but rasterising with WebGL2 where available.
- (b) Fully CPU: TS kernels plus a software rasteriser (ADR 0011 as written).
- (c) Both, choosing at run time.

**Recommendation:** (b). One path, the closest match (no MSAA or driver differences), and it runs in Node for tests. WebGL2 could be added later for speed if the fallback is too slow on phones.

### Q6. Real-GPU golden runs in CI

- (a) A self-hosted runner with a GPU (a spare Mac mini or a Linux box with a discrete card), label `gpu`.
- (b) Manual: developers run `npm run golden -- --adapter hardware` and attach the report.
- (c) A cloud GPU runner, paid.

**Recommendation:** (b) now, (a) by M10, when cross-adapter L1 has to be measured.

### Q7. Target browsers and devices

**Recommendation:**

- Chrome and Edge ≥ 121 desktop and Android, Safari ≥ 26 macOS and iOS, and Firefox ≥ 141 on Windows, all on WebGPU;
- everything else on the CPU engine;
- minimum screen 360 px wide;
- reference machines for the performance budget: an M1 MacBook Air, a mid-range Windows laptop with Intel Iris Xe, and a recent mid-range Android phone.

Please confirm, or name the devices you care about.

### Q8. Golden seeds and cameras

The captures use seeds {7, 4242} and cameras {preset view, az + 35° and incl + 20°}, plus Chalkboard for 3 presets: 186 captures, 68 MB.

- (a) Keep them.
- (b) Add a zoomed camera (zoom 2), which tests pen weight under zoom.
- (c) Add a third seed.

**Recommendation:** (a) plus (b), the zoom camera only for the 10 presets with the most line work. That adds about 20 captures.

**M3:** the zoom camera exists (`--extra` with `"cameras": ["home", "orbit", "zoom"]`, home at `__GEN.zoom(2)`), so far for the M2 stipple-only set (6 captures, all passing). The line-work presets get theirs as their milestones (M4, M5) add them to the required set.

### Q9. Scope of the rebuild beyond drawing

v21 also has:

- SVG export for pen plotters (`exportSVG`, L1155);
- an animated GIF encoder (L1673);
- the Galaxy Zoo 2 catalogue browser (239,695 galaxies, `fromVotes`, L1321);
- 42 real galaxies with photos;
- the timeline.

Options:

- (a) All in M11.
- (b) Drawing and page first; catalogue, real galaxies and exports in a later M12.
- (c) Drop some.

**Decided (4 October 2026): (b).** The catalogue browser, the real galaxies, and SVG and GIF export are milestone **M12** in docs/roadmap.md, after the page (M11). The timeline stays in M8 (mergers) and M11 (page). `fromVotes` is pure parameter mapping, so it lands in M12 with its own tests.

### Q10. Performance budget

docs/architecture.md proposes 60 fps orbit (< 4 ms GPU) on the reference machines, < 30 ms to first frame on a parameter change, and < 100 ms per frame for the CPU engine. Confirm, or change the targets.

### Q11. Git LFS

The plan was to put new binaries (goldens, spike screenshots) in Git LFS. **LFS uploads are refused from the environment this project is built in** (`POST …/verify: Forbidden` from the LFS endpoint), so the 186 golden captures (68 MB) and the spike screenshots are committed as ordinary blobs, like the asset pack (~108 MB).
- (a) Leave everything as ordinary blobs.
- (b) Enable LFS from a machine where it works, migrating `tests/golden/` and `spikes/` in one commit.
- (c) Later, `git lfs migrate import` across history, with a force-push of `main`, to shrink clones.

**Recommendation:** (a) for now. The repository is about 180 MB, which is fine for GitHub. Revisit with (b) if goldens are re-captured often.

### Q12. Should the new engine also reproduce v21's known oddities?

These are the reference-notes "flagged" items: atlas mip bleed, the dead overlay-trail branch (trails are placed in screen space, not the scene), and `sin`-hash noise.

**Recommendation:** fix all three as listed in docs/architecture.md, "Deliberate divergences". One question remains: should an overlay satellite trail stay fixed on the image (as v21 does in effect, and its comment says it intends: "a satellite near Earth doesn't turn with the galaxy") or move with the scene? **Recommendation:** keep it fixed on the image, as v21 does.

### Q13. v21 bugs whose effects are visible: reproduce them or fix them?

The reference notes (section 20) found bugs that change what v21 draws, so they are baked into the golden images:
- **`RMAX` is declared twice**, as 4.2 at L121 and 240 at L857. At run time it is 240, so the disc, halo, Sérsic and shell truncations never fire, and stars reach about 20 units out.
- **Vector marks ignore instance alpha** (L1212–1218). The ring meant to be drawn at 0.55 is drawn at full strength.
- **A cluster's deep field is sheared twice** (L902, then L1273).
- **The edge-on midplane stroke's alpha** uses `incl`, not `incE()` (L788), so it can exceed 1 above 90°.
- **Sérsic hosts and shells ignore the camera** (L223–233, L741–760).

The options:
- (a) Reproduce the visible behaviour (parity with the goldens).
- (b) Fix them all, and re-capture or adjust the affected goldens.
- (c) Decide each one.

**Recommendation:** (a) for M2–M9, so parity tests stay meaningful; each reproduced bug is marked in code with `// v21 parity: …` and a link to the notes. Then (c) as a pass after M9, each fix in its own pull request with a render diff. The `RMAX` truncation in particular changes the look of every galaxy (fainter, wider haloes), so it is your call rather than ours.

### Q14. Recalibrate the golden thresholds on real hardware

The golden thresholds (including the per-preset widening of ADR 0026, decided on 2026-10-07 for M5) were calibrated on SwiftShader, the software WebGPU the build environment has. The owner will re-run the calibration on their MacBook (a real GPU) after the M5 widening, and commit the result:

```
npm run golden -- --calibrate        # all shards, from scratch (long)
npm run golden                       # all 152 required cases must pass
npx prettier --write tests/golden/thresholds.json tests/golden/calibration.json
```

If a case then fails, or a negative control that was caught is missed, the thresholds or the ADR are revisited.

**M10 adds to the same visit** (docs/milestones/m10/README.md): the budget table and the L1 report need a real adapter, and the harnesses exist now:

```
ROSSE_WEBGPU_ADAPTER=hardware npm run perf -- --gpu     # perf/gpu-hardware.json: GPU timestamps per pass, wall clock, allocations
ROSSE_WEBGPU_ADAPTER=hardware npm run l1                # the adapter against the CPU engine at the strict thresholds
npm run perf:report                                     # rewrites docs/milestones/m10/perf-report.md
npx prettier --write docs/milestones/m10
```

Commit the changed files under `docs/milestones/m10/`. Check the first line each prints names an adapter other than SwiftShader (Chromium may need `ROSSE_CHROMIUM_ARGS`). Until then no budget of docs/architecture.md is claimed on real hardware; the integrated, discrete and mobile measurements are the M10 acceptance this environment could not do.

**Recommendation:** do it with M10's real-hardware pass (it is on that row's acceptance in docs/roadmap.md), or earlier if convenient.
