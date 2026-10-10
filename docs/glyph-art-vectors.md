# Shared vector glyph library

Every glyph output now draws contours: Canvas preview, ramp wells, PNG, MP4
and editable SVG. This replaces raster sprite stamping and export-time tracing.
Halftone geometry, source sampling, tone pools, shuffle, gradients, animation,
infinite hold and seamless loops keep their existing behavior.

## Catalogue and regeneration

`scripts/build-glyph-vectors.mjs` traces all 61,127 committed historical and
Church Slavonic scans across 27 groups, preserving catalogue order and ids.
The removed `a0009.png` stays excluded. The committed sprite sheets are the
reproducible inputs: no original-source directories or new packages are needed.
Node 22.18+ and existing Sharp are sufficient.

```sh
node scripts/build-glyph-vectors.mjs
node scripts/build-glyph-vectors.mjs --check
pnpm check
```

Run vector generation after rebuilding either historical or Church Slavonic
sheets. Each `src/preset-vectors/*.ts` records the source-sheet SHA-256 and
compact `[width, height, density, path]` entries. Tests verify every entry exists
and re-run generation against committed inputs.

Subpixel marching squares interpolates the half-ink edge, followed by the
existing corner-preserving cubic fitter. Very faint marks use half their peak
alpha instead of disappearing. Hole winding is retained; there is no speck
deletion that could remove punctuation or diacritics. Scanned coordinates use
hundredths of a source pixel, below the fitting tolerance. Vectorization removes
blurred fringes but does not reconstruct details absent from low-resolution
source scans; damaged printing may still have an irregular contour.

## Runtime

Preset packs load via a fixed Vite lazy import map, only for selected groups.
There is no runtime fetch API, external endpoint or upload; `connect-src 'none'`
stays unchanged. Modules use `script-src 'self'`, and the service worker caches
them for offline reuse. Original sprite sheets are omitted from `dist/presets`
by postbuild, leaving their committed regeneration inputs untouched.

Library entries retain compact paths and expand contours only when drawn.
Parsing yields every 64 entries for cancellation and progress. Each used shape
gets one cached `Path2D`, drawn directly at the requested scale with nonzero
fill; there is no fixed-resolution render texture to blur at large sizes.
SVG reads those same prepared coordinates and writes flattened editable paths
at 0.001 output-pixel precision, without resampling or tracing for printed size.

Loose text and uploaded PNG/JPEG/WebP/SVG marks are measured and traced once
on insertion, then reused for every frame. Uploaded SVG is decoded inertly
as before, not parsed as executable markup. Digital reaction icons and counters
retain their original authored curves; their rasterization only measures tone
and cropping and never supplies rendered artwork.

## Performance and budgets

Application JS + CSS retains its 300KB gzip ceiling. Lazy vector artwork has
separate limits: 10MB raw / 4MB gzip per preset and 48MB raw / 16MB gzip for
the entire library. This replaces the raster library's 6MB / 24MB raw ceilings;
production no longer carries both formats. Vector data compresses well but
requires JS parsing, and a gradient with many eras still loads all selected
groups. No claim that vectors are always cheaper to draw than bitmaps.

Local Chrome checks at 1024×768 / 1,200 cells cover WWII, Northern/Patriotic,
Civil War, Church Slavonic and reactions. Measured warm draw submission was
about 2–5ms/frame; GPU completion and larger grids can cost more. Canvas/SVG
normalized pixel difference was below 0.0003 on these mono test frames, and
all tested loops repeated exactly. Original native SVG fidelity tests remain.
Large SVGs can be heavier than the old size-dependent simplified traces,
because every output now retains the same complete shape at every size.
