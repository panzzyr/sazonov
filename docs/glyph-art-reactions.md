# Reaction counter provenance

Glyph art's two-digit reaction counters use Roboto Medium. The shipped alphabet
is `0123456789,k`, converted to filled SVG contours at 100 pt; it is a modified
subset, not a complete font. The fire and eye silhouettes are drawn in
`apps/glyph-art/src/reactions.ts`. Press F uses the owner's supplied `Asset 1.svg`,
preserved in `apps/glyph-art/src/assets/press-f.svg`. Run
`node scripts/build-press-f.mjs` to regenerate `src/generatedPressF.ts` on stdout.
Only relative/shorthand commands and the polygon are expanded to absolute paths;
the original curves and all three filled islands are preserved, not retraced.

The eye and counters are always separate marks. Every level carries all 180
counter values. Levels 0–2 have counters only; counter shares then decrease
from 90% to 70%, reaching 65% on levels 9–11. Those levels retain fire and press F
at 15% each, and the eye at 5%. Picking weights are shares of the whole family,
so adding counter variants cannot accidentally crowd icons out or vice versa.

- Source: [Google Fonts Roboto 2](https://github.com/googlefonts/roboto-2),
  `src/hinted/Roboto-Medium.ttf`.
- Source font SHA-256: `2879a5ecb7fbfa13a7fc3e2cdd7fecbf73aa45e91b541dfdfa2c442eed0aac21`.
- License: Apache-2.0; full text and modified-subset notice ship at
  `apps/glyph-art/public/licenses/roboto.txt`.
- Telegram Android's `AndroidUtilities.getTypeface` uses Roboto Medium for
  `fonts/rmedium.ttf`; see [its official source](https://github.com/DrKLO/Telegram/blob/master/TMessagesProj/src/main/java/org/telegram/messenger/AndroidUtilities.java).

On macOS, use the native CoreText generator; no third-party font parser is
required:

```sh
swift scripts/build-reaction-type.swift /absolute/path/to/Roboto-Medium.ttf
```

It prints the module to stdout. Review the result before replacing
`apps/glyph-art/src/generatedReactionType.ts`. Verify the source font checksum,
keep the license notice, then run `pnpm check`. The application composes counters
from this alphabet; exported SVGs contain filled paths, not font references,
`text`, emoji, masks or raster images.

The library rasterizes those SVGs only for canvas preview and density/tight-box
measurement. SVG export reads `spec.vector.path` and applies the same placement
to its original contours; it does not read or retrace the bitmap. Native path
coordinates retain thousandth-pixel precision (scanned outlines keep their
existing tenth-pixel precision). Regression tests export all 183 reaction marks
with bitmap access forbidden and compare every contour and control point to
the original transformed geometry, including rotation and cropped measurement.
