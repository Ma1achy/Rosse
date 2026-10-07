# Refreshing the README

The README (and its pictures) were written while M7, M9, M10, M11 and M12 were still open pull requests. When each lands, update the places below, then re-run `npm run readme:assets` where a picture changes (see `tools/readme-assets/README.md`).

## TODO

- [ ] **M7 (stars, artefacts, the sky).** In `tools/readme-assets/plan.mjs`, `NO_SKY` switches the foreground stars and the deep field off (`fgstars: 0, field: 0`). Try them on for the gallery and the banner; keep them off wherever they crowd the galaxy. Add a gallery plate for a bright star with spikes, or a satellite trail, and a line to the README's gallery. Mark M7 merged in the status table.
- [ ] **M9 (lensing).** Add a lensed plate (an Einstein ring or the giant arc) to the gallery and the `GALAXIES` and `STILLS` lists; the render page (`tools/readme-assets/render.ts`) draws single galaxies and mergers only, so it needs the lens path added. Mark M9 merged.
- [ ] **M10 (performance).** Replace "Not yet proven: all parity numbers are measured on SwiftShader" with the real-GPU result, and add the frame times that the budget table of `docs/architecture.md` now has measured values for. If the render script can use a real adapter, `ROSSE_WEBGPU_ADAPTER=default` is the switch (see `tools/gpu-test/browser.mjs`); the committed pictures were drawn on SwiftShader.
- [ ] **M11 (the page).** Replace "The page is the engine's testbed" in "Run it" with the real page: a screenshot (a Paper and a Chalkboard one), the controls, URL state and PNG export. If the page is deployed, add the live link next to the banner (and say which engine it falls back to). Re-shoot the banner if the design language changes. Update the URL parameters list.
- [ ] **M12 (the extras).** Add the Galaxy Zoo 2 catalogue browser, the real galaxies with photos and the SVG and GIF export to the feature table, with the SDSS acknowledgement text the owner wants beside the photos. Re-check the credits section (Galaxy Zoo 2 citation and CC BY 4.0, SDSS terms).
- [ ] **Licence.** When Q1 is decided (docs/open-questions.md), replace "undecided" in the README's credits, add a badge only if it is real, and list the fonts' and photographs' terms accurately.
- [ ] **Milestone table.** Mark each milestone merged as it lands and drop the pull-request numbers.
- [ ] **Counts.** "582 captures of v21" and "156 whole galaxies" are read from `tests/golden/reference/` and `assets/README.md`; update them if the reference set grows.
