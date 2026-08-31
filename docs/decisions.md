# Architecture decisions

## 2026-08-31 — Cut marks from whole pages by connected components

- **Decision:** `scripts/harvest-glyphs.mjs` turns a background-removed page of
  letterpress into candidate marks by labelling connected islands of alpha,
  then filtering on size, proportion, fill, crispness and recurrence. It writes
  marks in the same shape a hand-picked scan arrives in, so the preset builder
  treats the two identically.
- **Alternatives:** Run a vision model over the page to detect and classify
  glyphs. Or keep picking marks by hand, which is what this replaces.
- **Reason:** A cleaned letterpress page is ink on transparency, so a letter
  *is* a connected island of alpha. Labelling those islands is 1970s
  morphology: a tenth of a second for a ten-megapixel page, exactly
  reproducible, no model and no cost. What a model would add is a *name* for
  each island, and the tool never needs one — it sizes a mark by the ink it
  measures, not by which letter it is. Recognition would be an expensive way to
  produce a label nothing reads.
- **Consequences:** Quality depends entirely on the background having been
  removed first; that step stays manual and is the only one that matters. Four
  pages yield 2839 candidates, so the builder now has to *choose* rather than
  use everything it is given. Pages live in `assets/glyph-pages/`, gitignored
  like every other original. `docs/harvesting-marks.md` is the walkthrough.

## 2026-08-31 — Crispness separates type from stains

- **Decision:** An island whose ink is less than a third at full strength is
  rejected, measured as the share of inked pixels above alpha 191.
- **Alternatives:** Filter on size, shape and fill only. Or clean the pages
  harder before harvesting.
- **Reason:** A page carries soft grey rubbish alongside its type — show-through
  from the far side of the leaf, a thumbprint, the ghost of a fold, the halo
  where a stain was cleaned away. These pass every test of size, shape and fill,
  some being exactly letter-sized and letter-shaped, and they print as mud. What
  separates them from type is not shape but edge: a letter pressed into paper is
  bimodal, nearly all ink or nearly all paper with a pixel of transition, while
  a stain is *all* transition. The threshold is not delicate — below 0.20 is
  uniformly rubbish and above 0.33 uniformly type.
- **Consequences:** It took `north.png` from 2431 islands to 626, because that
  page had been cleaned in a way that left heavy ghosting. A page cleaned
  differently will lose a different proportion, and that is the filter working
  rather than a threshold needing adjustment.

## 2026-08-31 — A level's marks are chosen to be unlike each other

- **Decision:** After the first mark of a level — chosen on print quality,
  because the ramp measures the level's size from it — every further mark is the
  candidate furthest in shape from those already chosen, with print quality as a
  weight. Shape distance is the RMS difference of a 12×12 thumbnail taken from
  the mark's tight box.
- **Alternatives:** Take the top N of the ranked list, which is what the first
  version did, with a rule against two marks of the same proportion.
- **Reason:** A pool is not a fallback list. Every mark in it prints, cycling
  from cell to cell, so the pool size *is* how varied that level looks. Ranked
  by print quality alone, a level of ten fills with ten impressions of the same
  letter — technically ten marks, visibly one, and the whole reason for a pool
  is lost. The proportion rule was an approximation of this that could not see
  the difference between two different letters of the same width.
- **Consequences:** The four hand-picked sets re-solved to slightly different
  ladders, and a few of their marks are no longer used. Pool sizes became
  per-set, since a set of fourteen scans cannot fill a level of ten and a case
  of newspaper type can. Twelve is the hard ceiling, because
  `projectState.readBands` slices a band there.

## 2026-08-31 — Only marks a level names are written

- **Decision:** The builder wipes each set's output directory and writes a WebP
  only for marks that appear on some level.
- **Alternatives:** Write every candidate and let the ramp reference a subset.
- **Reason:** A harvested set offers thousands of candidates and a ramp uses a
  hundred; shipping the rest is megabytes of marks nothing points at. It also
  keeps `presetGlyphIds` — which is what makes a preset path safe to load from
  an untrusted project file — an exact description of what is deployed.
- **Consequences:** Rebuilding can retire a mark id. A project saved against an
  older build that named a now-unused mark loses that mark; `readGlyphs` drops
  preset ids this build does not ship, so it degrades to the rest of the band
  rather than breaking. The asset budget also became two numbers — 160 KB for
  any single set, which is what a visitor downloads, and 512 KB for the library,
  which is what the repository carries.

## 2026-08-27 — Preset levels are solved from size, not authored per mark

- **Decision:** Which of the twelve levels a scanned mark prints on is decided by
  `scripts/build-glyph-presets.mjs`, not by hand. Every scan is measured for ink
  density, proportion and median stroke width; a mark is eligible for a level if
  the size it must print at to hit that level's ink lands inside
  `[0.14, 1.15]` cells, and is ranked within it by how near that size is to
  two-thirds of a cell and how many pixels of stroke survives at print size. A
  mark may serve up to three levels at different sizes.
- **Alternatives:** Sort the marks by their own ink and hand the darkest to the
  darkest level — the natural reading of "pixelize each glyph and compare", and
  what a designer does in Photoshop.
- **Reason:** A mark's own density does not decide its level, because the solver
  can print any mark at any level by changing its size. What actually fails is
  the size: a solid woodblock reaches a light level only by shrinking to grit,
  and an airy letter reaches a dark one only by overflowing its cell. Sorting by
  density fixes one mark per level and throws away the reuse that gives a level
  its texture. Stroke width is the second gate because it catches the failure
  the coverage arithmetic cannot: a mark of fine rules at a third of a cell is a
  grey smudge long before it is too small to see.
- **Consequences:** Adding a scan means dropping it in `assets/glyph-presets/`
  and re-running the script; the levels re-solve and may move. The originals
  stay out of git, as printor's texture scans do. `tests/presets.test.ts`
  asserts the guarantees the solve is supposed to give — twelve levels, two
  marks each and four on the darkest three, nothing past the ceiling, equal ink
  from every mark on a level.

## 2026-08-27 — `peak` and `maxSize` become project settings

- **Decision:** The two constants the ramp was built on — `coveragePeak = 1.05`
  and `maxMarkSize = 1.6` — become `settings.peak` and `settings.maxSize`, and
  `fitPeak` solves the first from the second across every band and every mark.
  Presets carry their own `peak` and pin `maxSize` to 1.15.
- **Alternatives:** Keep one global peak and let sparse sets clamp. Or derive
  the peak automatically on every solve, with no stored value.
- **Reason:** The peak is a property of the *set of marks*, not of taste: airy
  letterpress cannot cover as much of a cell as a solid woodblock without
  spilling out of it, and one global value either clogs the solid sets or leaves
  the airy ones clamped flat across their top bands. Deriving it silently on
  every solve would make changing one mark rescale the whole ramp with nothing
  on screen to explain it.
- **Consequences:** Two more sliders in the tone panel, and a `fit ramp` button
  that is the only way most users will set `peak`. `fitPeak` has to check every
  band, not only the darkest: fitting on the darkest alone leaves a sparse mark
  in the middle of the ladder clamped, which is the exact failure the button
  exists to prevent.

## 2026-08-27 — Halftone is a second renderer, not another mark

- **Decision:** `settings.mode` switches between the glyph path and a separate
  `HalftoneRenderer` with its own settings block: ruling, angle, dot shape,
  separation, gain, spread, black generation and frame width. It shares the tone
  field with the glyph path and nothing else.
- **Alternatives:** Ship a round mark and call a dense grid of it a halftone.
- **Reason:** They are different principles. glyph art has cells and carries
  tone in a mark's size; a halftone has a frame-independent lattice at its own
  ruling and angle and carries tone in a dot's area, and its colour comes from
  screening separate plates at angles 30° apart, not from tinting one ink. A
  rosette cannot be produced by rotating a grid of marks. Forcing the two
  through one renderer would mean a settings object where half the fields are
  dead in either mode, which is how a tool starts lying about what it does.
- **Consequences:** The bands, the ramp editor, the seed, `hand` and the cycling
  controls are hidden in halftone mode, because none of them mean anything
  there. The frame size comes from `sequenceSize` for both modes, so the preview
  and the encoder cannot disagree.

## 2026-08-09 — glyph art solves mark size from ink coverage

- **Decision:** A tone band stores a target *ink coverage*, not a size. Every
  mark is rasterized and measured on load for its ink density ρ over its tight
  bounding box, and the printed size is solved as `sqrt(c / (ρ · min(a, 1/a)))`.
  The coverage curve itself is authored, `c = 1.05 · t^weight`, not photometric.
- **Alternatives:** Map tone linearly to size, the obvious reading of the brief.
  Or derive coverage photometrically from `1 − luminance`.
- **Reason:** Coverage grows as the square of size, so a linear map gives a
  half-tone cell a quarter of its ink: midtones wash out, shadows slam shut, and
  a thin comma reads the same tone as a solid square. Photometric coverage is
  correct for a 300 lpi screen and disastrous at 24 px cells, where the eye
  reads mark size directly rather than integrating the cell — it reaches nearly
  half coverage by the second band of seven and clogs the picture solid.
- **Consequences:** Marks cannot be drawn without being measured first, so the
  library rasterizes everything — shipped, typed and uploaded — through one
  path. A cycling band also has to correct each member by `sqrt(ρ_ref/ρ)`, or
  the tone pulses as it cycles. The ramp arithmetic is pure and unit-tested
  without a canvas.

## 2026-08-09 — glyph art renders on canvas2d, not WebGL2

- **Decision:** Draw the grid with `drawImage` onto a 2D canvas, accumulating
  the marks in an alpha mask and colouring the mask in one `source-in` pass.
- **Alternatives:** Reuse printor's WebGL2 approach with a glyph atlas and
  instanced quads.
- **Reason:** The primitive here is "draw a sprite at a position and a size",
  which is exactly what canvas2d is. The default grid is about 3,900 draws per
  frame. An atlas would force uploaded SVG to be rasterized at one fixed size
  and would roughly double the engine code for no visible gain. Accumulating in
  alpha also makes ink *union* rather than stack, so overlapping shadows never
  bruise and draw order is irrelevant — and it makes the source-colour mode one
  extra `drawImage` instead of forty thousand tinted ones.
- **Consequences:** The output raster is derived from the grid rather than the
  source, so the preview canvas is the export frame and printor's whole
  `u_pixel` class of preview/export mismatches cannot occur. `cellPixels` is
  kept even so H.264 never has to resize the frame.

## 2026-08-09 — glyph art has no fit setting

- **Decision:** The output's aspect follows the source's. The grid height is
  derived from the grid width, and the source is centre-cropped by the sub-cell
  remainder.
- **Alternatives:** A `cover`/`contain` toggle, as the art direction proposed.
- **Reason:** Both options answer a question the tool never asks, because there
  is no target frame to fit into — the frame *is* the source's shape. "Follow
  the source" is the answer, and it is one fewer control in a tool whose owner
  asked for fewer.
- **Consequences:** Square or letterboxed output is the user's job upstream.

## 2026-08-09 — Articles and tools become sections again

- **Decision:** Add `/tools/` and `/articles/` per language, with the header
  reduced to Tools, Articles, About, and the newest articles on the home page.
  The site ships one script, `/theme.js`, and its CSP moves to `script-src
  'self'`.
- **Alternatives:** Keep the two-page site and put each guide inside its own
  tool; keep the zero-JavaScript rule and drop the theme toggle.
- **Reason:** Two tools with real instructions is enough content for the
  sections to carry their weight — the 2026-08-06 decision below was made when
  there was one tool and nothing written about it. A theme toggle that persists
  across navigation cannot be done in CSS alone, and a blocking same-origin
  script is the only version with no flash of the wrong palette.
- **Consequences:** The homepage budget check now permits exactly one script,
  `/theme.js`, and still fails on any other. The theme contract — the
  `sazonov-theme` key and the `data-theme` attribute — is shared verbatim by
  both tools, which are separate documents on the same origin.

## 2026-08-06 — The site is a home page, an about page, and printor

- **Decision:** Strip the portfolio to two routes per language. Posts, projects,
  the tools index, the CV page, and both Atom feeds are gone; `/about/` carries
  the whole biography, the links to kmbnt.ru and victim.team, and the CV PDF.
- **Alternatives:** Keep the sections and leave them empty, or hide them behind
  `draft: true`.
- **Reason:** The site exists to hand people printor. Section pages that list
  nothing are worse than no section pages.
- **Consequences:** `apps/site/src/content/` no longer exists, so the `posts` and
  `projects` collections, the `whereLang`/`limit`/`readingTime` filters, and the
  Temml math plugin went with them — `markdown-it` and `temml` are no longer
  dependencies. `scripts/lint-content.mjs` now returns quietly when the content
  directory is absent, so restoring Markdown content restores its checks.

## 2026-08-06 — The deploy workflow runs the same build as CI

- **Decision:** `.github/workflows/pages.yml` runs `pnpm build` rather than
  `pnpm --filter @sazonov/site build` plus a budget check.
- **Reason:** The narrower command skipped the printor build and
  `scripts/nest-printor.mjs`, so the deployed artifact never contained
  `_site/printor/` and `sazonov.space/printor` returned 404 while `pnpm check`
  passed locally and in CI.
- **Consequences:** Deploys take longer because they build printor, and the two
  workflows can no longer drift on what "built" means.

## 2026-08-05 — One Pages deployment, printor on a sub-path

- **Decision:** Publish printor at `sazonov.space/printor/` from the portfolio's
  Pages deployment instead of a separate repository and subdomain. `pnpm build`
  nests `apps/printor/dist/` into `apps/site/_site/printor/`.
- **Alternatives:** A second repository mirroring `apps/printor/` and deploying
  to `printor.sazonov.space`, which is what the first attempt set up.
- **Reason:** The separate repository existed to dodge a size limit that is not
  real — the converted texture library is 15 MB against a 1 GB Pages ceiling. One
  repository means one `pnpm check`, no mirror to keep in sync, and no second
  DNS record or certificate to wait on.
- **Consequences:** printor is built with `base: "/printor/"`, so every runtime
  asset lookup has to go through `import.meta.env.BASE_URL`; a root-absolute path
  silently breaks the sub-path. `PRINTOR_BASE=/` restores a root-domain build.

## 2026-08-05 — Range-based parameters resolved on the CPU

- **Decision:** Every effect parameter is a min/max range; the concrete value
  for a frame is drawn in `engine/frameParams.ts` and handed to the shader as a
  finished scalar. The shader generates only spatial noise.
- **Alternatives:** Draw the random values inside the shader, as the first
  release did.
- **Reason:** Preview and export must agree exactly. Resolving on the CPU means
  one function defines a frame, it is unit-testable without a GL context, and
  the texture chosen for a frame can be loaded before the draw.
- **Consequences:** Adding a parameter now touches `frameParams.ts` as well as
  types, shader, and renderer.

## 2026-08-05 — Torn edges instead of colour dithering

- **Decision:** Replace the colour dither stage with a grain/gain pass feeding a
  threshold whose boundary is perturbed by fbm noise, and make the output
  strictly grayscale.
- **Alternatives:** Keep the ordered-dither look; approximate with a plain
  threshold.
- **Reason:** The target is silkscreen, not halftone reproduction. A plain
  threshold cuts a clean line; grain plus a low-frequency perturbation tears the
  boundary along paper-fibre shapes, which is what Photoshop's Torn Edges does.
- **Consequences:** Colour is gone from the pipeline. Ink separation now happens
  at export time by keying black or white to alpha.

## 2026-08-05 — Ship a converted texture library, not the scans

- **Decision:** Keep full-resolution source scans out of git under `assets/`,
  and commit a 2048 px WebP library generated by
  `scripts/build-texture-library.mjs`. Cutout masks are reduced to their alpha
  channel.
- **Alternatives:** Commit the originals (465 MB); load textures from a CDN.
- **Reason:** A static Pages deployment cannot carry 465 MB, and a CDN would
  break `connect-src 'none'`. The conversion lands at about 15 MB.
- **Consequences:** Adding a texture means dropping it in `assets/` and
  re-running the build script; the originals must be kept somewhere else.

## 2026-08-05 — mp4-muxer for video export

- **Decision:** Add `mp4-muxer` and encode H.264 through WebCodecs.
- **Alternatives:** PNG sequences only; MediaRecorder WebM; a WASM ffmpeg build.
- **Reason:** The tool posterizes frame rate, so handing back a video at the new
  rate is the expected output. mp4-muxer is about 15 KB and keeps the bundle far
  inside the 300 KB gzip budget; a WASM encoder would not.
- **Consequences:** MP4 needs a WebCodecs H.264 encoder, so the button is
  disabled where that is missing and PNG export stays the universal path. H.264
  has no alpha, so the ink passes remain PNG-only.

## 2026-07-29 — Publish only implemented tool states

- **Decision:** Display printor and proxiguesse as “in development” until their
  applications and production URLs exist.
- **Alternatives:** Use the “live” label from the content draft or invent a URL.
- **Reason:** A portfolio should not publish broken links or inaccurate status.
- **Consequences:** Update the shared tools data when each deployment is live.

## 2026-07-29 — Temporary text mark

- **Decision:** Use an inline “S” text mark until the owner supplies `logo.svg`.
- **Alternatives:** Redraw the absent logo or omit the home link.
- **Reason:** The supplied design requires a visible home link but forbids
  recreating the owner's artwork.
- **Consequences:** Replacing one include with the optimized SVG completes the
  intended identity without changing layout.

## 2026-07-29 — First printor release pipeline

- **Decision:** Ship a WebGL2 single-pass renderer with reorderable logical
  effects and PNG ZIP export before adding WebCodecs video encoding.
- **Alternatives:** Delay release until MP4/WebM export and worker rendering.
- **Reason:** PNG sequences are the specified universal baseline and make the
  first release useful without browser codec differences.
- **Consequences:** Full-resolution export yields between frames but remains on
  the UI thread; worker rendering and encoded video remain the next milestone.
