# Threshold — handwriting fonts by -M  (version 1.4)

Three fonts made from your own handwriting. Each comes as a `.ttf` (install on your computer) and a `.woff2` (for websites).

| Font | Hand | Source | Characters |
|---|---|---|---|
| **Threshold Grain** | the marker hand | your felt-tip pages p1–p7 and sheet 3 | 424 |
| **Threshold Patina** | the notes hand | your OneNote vector-calculus notes | 218 |
| **Threshold Mark** | the Polaroid capitals | the Sharpie lettering on the Polaroid borders | 103 |
| **Threshold Signs** | icons | your icon sheets | 56 signs |

## What's in Grain

- **Letters:** A–Z and a–z, three versions of each, cycling as you type so neighbours never repeat a shape.
- **Digits:** 0–9, two or three versions each, cycling too.
- **Greek:** the full alphabet, capitals and lowercase, plus ϕ, ϑ and ς. Several have extra versions (Δ δ ξ ρ Θ).
- **Maths:** ∇ ∂ ∑ ∫ ∮ ∬ ∯ ∭ ∰ √ ≠ ≤ ≥ ≈ ≡ ∼ ≃ ≅ ≪ ≫ ∞ ∝ ± ∓ × ÷ ⋅ ° − and more; sets and logic ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ ∀ ∃ ⇒ ⇔; ⊥ ∥ ∠ ⊗ ⊕; ∎ for the end of a proof.
- **Physics:** ℏ ℎ ℓ, bras and kets ⟨ ⟩, primes ′ ″, e⁺ e⁻, and νₑ ν̄ₑ as drawn ligatures.
- **Superscripts and subscripts:** ⁰–⁹ and ₀–₉ (and ₑ), made from your digits.
- **Dots and bars:** ẋ ẍ ṗ ẏ ż r̈ x̄ v̄ a̲, drawn by you; typing a letter then a combining dot, diaeresis or macron gives these drawings.
- **Hats and vector arrows, as you drew them:** 40 hatted letters and 48 arrowed letters from your pages, each its own drawing. Type a letter then U+0302 (hat) or U+20D7 (arrow) and your drawn pair appears: x̂ ŷ ẑ r̂ t̂, E⃗ B⃗ F⃗ v⃗ r⃗ a⃗ p⃗. Letters you didn't draw a pair for (n̂, î, θ̂, Q⃗, V⃗, N⃗, Y⃗ …) use your hat or arrow as a mark, placed above the letter. Grave, acute (your grave, mirrored) and diaeresis work the same way.
- **Accented letters:** é è ê ë á à â ä í ì î ï ó ò ô ö ú ù û ü ÿ ŵ ŷ and capitals É È Ê Ë Ö Ü Ñ Â Ô Û Î Ï À Á Ó Ú Ä.
- **Money and punctuation:** £ $ % & @ # and the rest.
- **Your drawings:** ☺ ☹ ♡ ☆ ☀ ☼, and the spiral at U+E000 (also 🌀).

## On a website

```css
@font-face {
  font-family: "Threshold Grain";
  src: url("/fonts/ThresholdGrain-Regular.woff2") format("woff2");
  font-display: swap;
}
body { font-family: "Threshold Grain", cursive; }
```

Same for `Threshold Patina` and `Threshold Mark`. Letter-cycling is on by default in modern browsers; `font-feature-settings: "calt" 0;` turns it off.

## Version notes

**Patina** — from your notes directly: `'(,.3BCEGINSTWacdefhijklmnoprsuvwxy`. Everything else is borrowed from Grain, reshaped to Patina's size and pen, until more notes come in. The biggest gains next: t, g, b and the digits.

**Still to draw, if you want them:** a bullet • (a solid dot reads as a punched hole in a photo, so draw it as a ring, or tell me), lowercase õ, and second and third versions of the sheet 3 characters so they cycle like the letters.

## Threshold Signs

Icons from your drawings, one per code point. Standard symbols sit at their Unicode points, so `▶ ⏸ ✓ ☐ ☆` type as themselves; the rest are in the private-use range (U+E001 upward), so paste them from the table or use `&#xE00C;` in HTML. Ticks, crosses, boxes, stars, hearts and the turning arrows have two or three versions that cycle. Every sign is also in `signs/` as a transparent PNG, 128 px tall, for places a font can't go (like the Polaroids).

| sign | name | code |
|---|---|---|
| 🔈 | speaker | U+1F508 |
| 🔇 | mute | U+1F507 |
| 🔊 | sound | U+1F50A |
| ⏸ | pause | U+23F8 |
| ⏹ | stop | U+23F9 |
| ▶ | play | U+25B6 |
| ⏩ | fast forward | U+23E9 |
| ⏪ | rewind | U+23EA |
| ⏭ | skip forward | U+23ED |
| ⏮ | skip back | U+23EE |
| ⏺ | record | U+23FA |
| ○ | circle | U+25CB |
| ⛶ | full screen | U+26F6 |
|  | frame | U+E001 |
|  | expand all | U+E002 |
| ⤢ | expand | U+2922 |
| ⤡ | expand (other diagonal) | U+2921 |
| ☐ | box | U+2610 |
| ☒ | crossed box | U+2612 |
| ☑ | ticked box | U+2611 |
| ✓ | tick | U+2713 |
| ✗ | cross | U+2717 |
| ✘ | bold cross | U+2718 |
| 🌀 | spiral | U+1F300 |
|  | spiral, wide | U+E003 |
|  | spiral, open | U+E004 |
|  | squiggle | U+E005 |
| ∿ | sine wave | U+223F |
|  | bump | U+E006 |
| 〰 | waveform | U+3030 |
| ☆ | star | U+2606 |
| ✡ | hexagram | U+2721 |
| ♡ | heart | U+2661 |
|  | dashed line | U+E007 |
|  | dashed spiral | U+E008 |
|  | dashed trail | U+E009 |
| 🌠 | shooting star | U+1F320 |
|  | comet | U+E00A |
|  | comet, spiralling | U+E00B |
| ⇩ | down | U+21E9 |
| ⇧ | up | U+21E7 |
| ⇨ | right | U+21E8 |
| ⇦ | left | U+21E6 |
| 🌲 | tree | U+1F332 |
| ☾ | moon | U+263E |
| 🐈 | cat | U+1F408 |
|  | Polaroid | U+E00C |
| ⧉ | duplicate | U+29C9 |
|  | import | U+E00D |
|  | export | U+E00E |
|  | save | U+E00F |
| ↻ | turn clockwise | U+21BB |
| ↺ | turn anticlockwise | U+21BA |
| ♪ | quaver | U+266A |
| ♫ | beamed quavers | U+266B |
| 𝄞 | treble clef | U+1D11E |
