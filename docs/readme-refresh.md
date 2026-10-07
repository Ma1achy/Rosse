# Refreshing the README

The README's pictures are drawn by the engine, so they go stale when the engine changes. Everything is re-runnable from `tools/readme-assets/` (see its README for the stages):

```sh
nice -n 15 npm run readme:assets            # every picture, about two hours on SwiftShader
nice -n 15 npm run readme:assets -- gifs --only=merger-mice
npm run readme:check                        # links exist, sizes are within budget
```

Every galaxy, seed, parameter and camera path is in `tools/readme-assets/plan.mjs`; `docs/img/manifest.json` and `tools/readme-assets/gz2-picks.json` record what the script resolved (the preset list, the catalogue's picks). A plate is cached by a hash of its shot and of `git rev-parse HEAD:src`, so after an engine change `npm run readme:assets` re-draws what changed and `--fresh` forces all.

## After an engine change

1. Run the stage that shows what changed (`gallery`, `gifs`, `anatomy`, `gz2`, `banner`), look at the pictures (they are in `docs/img/`), and commit them.
2. If a preset was added, the contact sheet (`docs/img/figures/presets.jpg`) picks it up on its own; add the preset to a figure of `plan.mjs` if it deserves a close-up, and a line to the README.
3. If the catalogue decode or `fromVotes` changed, `gz2` re-picks and re-draws; `git diff tools/readme-assets/gz2-picks.json` shows what moved.
4. `npm run readme:check`.

## Owner decisions and open points

- **SDSS acknowledgement wording (owner must verify).** The SDSS "citing" page (https://www.sdss.org/collaboration/citing-sdss/) could not be fetched from the machine that made this README (the network policy blocked `www.sdss.org` and `skyserver.sdss.org`), so the README's credit points to SDSS's page for its wording and does not quote it. Paste the current acknowledgement for the data release the cutouts come from (the cutout service in `plan.mjs` is SkyServer DR19) into the README's credits and into `SDSS_ACKNOWLEDGEMENT` in `src/extras/attribution.ts`, which the page also shows.
- **SDSS cutouts of the Galaxy Zoo 2 picks.** The catalogue has votes, not pictures, and the machine that made this README could not reach SkyServer (HTTP 403 from the egress proxy on the CONNECT). The category plates are therefore drawn as Rosse's drawing with the votes beside it. On a machine with network access, run `npm run readme:assets -- fetch-gz2` once (it writes `docs/img/gz2/cutouts/` and a manifest of object id, RA, Dec, URL and retrieval date), commit the files, run `npm run readme:assets -- gz2`, and the plates become "photograph | drawing". The README's caption for them needs no change; the credits already name SDSS and Galaxy Zoo 2.
- **GZ2 licence line.** Galaxy Zoo 2 is CC BY 4.0 (Willett et al. 2013, MNRAS 435, 2835); the README credits it and says the drawings are Rosse's.
- **Cinematic films.** The engine's camera has no pan, only `az`, `incl`, `pa` and `zoom` about the galaxy's centre; the films use those (a push-in is the zoom). A true pan would need a camera parameter in the engine.

## TODO when the owner decides

- [ ] **Licence.** When Q1 is decided (docs/open-questions.md), replace "undecided" in the README's credits and add a badge only if it is real.
- [ ] **Milestone table.** The README's status table follows the integration branch (M0 to M12 built; what is open is listed under it); update it when pull request #15 reaches `main`.
- [ ] **Real-GPU numbers.** The pictures were drawn on SwiftShader; when M10's real-hardware numbers are in, update "Not yet proven" in the status section.
- [ ] **Counts.** "582 captures of v21" and "156 whole galaxies" are read from `tests/golden/reference/` and `assets/README.md`; the reference set is now 834 captures (with the 28 draws of v21's stipple that ADR 0036 and 0061 add). Update the README's number if it says so.
