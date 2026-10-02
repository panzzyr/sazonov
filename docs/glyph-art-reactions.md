# Reaction counter provenance

Glyph art's two-digit reaction counters use Roboto Medium. The shipped alphabet
is `0123456789,k`, converted to filled SVG contours at 100 pt; it is a modified
subset, not a complete font. The original fire, salute and eye silhouettes are
drawn in `apps/glyph-art/src/reactions.ts`.

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
