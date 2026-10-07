# Licences of the third-party and owner-made material in the asset pack

This records what the pack itself says about each font, and nothing more. Where the pack gives no terms, this file says so. The project's own licence (code and drawings) is still undecided: see `LICENSE` and `docs/open-questions.md`, Q1.

## Fonts (`assets/fonts/`)

| font | files | terms as the pack gives them |
| --- | --- | --- |
| Threshold Grain, Mark, Patina and Signs; "Principia Hand" | `ThresholdGrain_loaded-as-Principia-Hand.woff2`, `Threshold_Mark.woff2`, `kit-originals/*` | The owner's own handwriting, made into fonts (`kit-originals/README.md`: "fonts made from your own handwriting"). Owner decision of 2026-10-07: unrestricted, no licence concern. |
| Principia Hand (the earlier face) | `Principia_Hand.ttf` | The pack calls it "the earlier handwriting, before the design pass" (`fonts.json`, `assets/README.md`) and gives no author or licence. Not loaded by the page. |
| IBM Plex Mono (400, 400 italic, 600, 700) | `ibm-plex-mono/*.woff2` | SIL Open Font License 1.1, "Copyright © 2017 IBM Corp. with Reserved Font Name 'Plex'". The licence text is `ibm-plex-mono/OFL-LICENSE.txt`, as the pack includes it. The page loads the 400 weight. |
| Heros (400, 700, 400 italic) | `Heros-400.otf`, `Heros-700.otf`, `Heros-400-italic.otf` | The pack includes no licence file for Heros and `fonts.json` gives no origin beyond "rosse". The font files' own name table reads: "TeX Gyre Heros, Copyright 2006, 2009 for TeX Gyre extensions by B. Jackowski and J.M. Nowacki (on behalf of TeX users groups). This work is released under the GUST Font License, see http://tug.org/fonts/licenses/GUST-FONT-LICENSE.txt". That text has not been fetched or checked here, and whether the "Heros" family name and these files meet that licence's conditions has not been checked. The page loads the 400 and 700 weights. |

## Photographed objects and pictures (`assets/objects/`, `assets/embedded-other/`)

The page uses a few small files from v21's own embedded pictures (`src/ui/art/`: the hand-lettered tabs, the post-it pile, the paper sheets). The pack describes them as photographs of physical objects and as v21's embedded images, and gives no author or licence for them.

## Data (`assets/data/`)

The Galaxy Zoo 2 catalogue and the photographs of real galaxies are not used by the page yet (M12). The pack does not record their terms; `docs/open-questions.md` (Q1) notes that Galaxy Zoo 2 is credited under CC BY 4.0 and that SDSS imagery needs its acknowledgement, which is the project's reading, not a statement in the pack.
