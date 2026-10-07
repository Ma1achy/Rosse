# Refreshing the README

The README's text says the truth of the integration branch (pull request #15: M0 to M12 built, what is open). Its pictures were drawn before M7, M9 and the page landed. A separate pass refreshes the pictures; the checklist is what it has to do. Rules that stand: no red or magenta in any README image, the banner stays as the owner approved it, and `npm run readme:assets` (see `tools/readme-assets/README.md`) draws them.

## TODO (pictures)

- [ ] **M7 (stars, artefacts, the sky).** In `tools/readme-assets/plan.mjs`, `NO_SKY` switches the foreground stars and the deep field off (`fgstars: 0, field: 0`). Try them on for the gallery; keep them off wherever they crowd the galaxy. Add a gallery plate for a bright star with spikes, or a satellite trail, and a line to the README's gallery.
- [ ] **M9 (lensing).** Add a lensed plate (an Einstein ring or the giant arc) to the gallery and the `GALAXIES` and `STILLS` lists; the render page (`tools/readme-assets/render.ts`) draws single galaxies and mergers only, so it needs the lens path added. The quasar flare is a GIF candidate now that its GIF export exists.
- [ ] **M11 (the page).** Add screenshots of the page (a Paper one and a Chalkboard one: the Choose tab with the real galaxies, the merger with its timeline). The README text describes the page already.
- [ ] **M12 (the extras).** A picture of the real-galaxy card (photograph beside drawing) and of an SVG opened in a plotter program, if wanted.
- [ ] **M10 (performance).** Replace "Not yet proven: all parity numbers are measured on SwiftShader" only when real-GPU numbers exist (docs/open-questions.md Q14). The committed pictures were drawn on SwiftShader; `ROSSE_WEBGPU_ADAPTER=default` is the switch for a real adapter (`tools/gpu-test/browser.mjs`).

## TODO (owner)

- [ ] **Licence.** When Q1 is decided (docs/open-questions.md), replace "undecided" in the README's credits, add a badge only if it is real, and list the fonts' and photographs' terms accurately. The SDSS acknowledgement wording on the page (`src/extras/attribution.ts`) is the owner's to confirm.
- [ ] **Counts.** "582 captures of v21" and "156 whole galaxies" are read from `tests/golden/reference/` and `assets/README.md`; the reference set is now 834 captures, with the 28 draws of v21's stipple that ADR 0036 and 0061 add. Update the README's number if it says so.

Done on the integration branch: the milestone table says M0 to M12 are built and lists what is open; the "Run it" section describes the page, its exports and its links; the credits say where Galaxy Zoo 2 and SDSS are used.
