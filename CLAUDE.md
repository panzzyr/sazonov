# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 22 and pnpm 10.24.0 (`packageManager` is pinned; CI uses `--frozen-lockfile`).

```sh
pnpm install
pnpm dev:site        # Eleventy at http://localhost:8080
pnpm dev:printor     # Vite at http://127.0.0.1:5173
pnpm dev:glyph-art   # Vite at http://127.0.0.1:5174
pnpm check           # lint && build && test — the gate CI runs
```

`pnpm check` expands to `pnpm lint` (content lint + `tsc --noEmit`), `pnpm build`
(all three apps plus the size/CSP budgets), then `pnpm test`.

**Test order matters.** `node --test tests/*.test.mjs` asserts against generated
HTML in `apps/site/_site/`, so `pnpm test` only passes after a build. Run
`pnpm build` first, or just use `pnpm check`.

Per-app and single-test invocations:

```sh
pnpm --filter @sazonov/printor test              # vitest run
pnpm --filter @sazonov/glyph-art test
pnpm --filter @sazonov/glyph-art exec vitest run tests/ramp.test.ts
pnpm --filter @sazonov/printor exec vitest run -t "deterministic"
pnpm --filter @sazonov/printor lint              # generates textures, then tsc --noEmit
node --test tests/site.test.mjs                  # single site test file (needs a site build)
pnpm build:drafts                                # site build including draft: true content
node scripts/build-glyph-presets.mjs             # rebuild the preset marks (needs assets/)
node scripts/build-glyph-presets.mjs --sheet out # ...and print a proof sheet of every ladder
SITE_URL=https://preview.example.com pnpm build  # override production origin
```

## Hard constraints enforced by the build

These fail the build, not just a lint warning:

- `scripts/budget.mjs` — Brotli-compressed `apps/site/_site/index.html` must stay
  under 14,336 bytes. The homepage inlines all CSS and may load exactly one
  script, `/theme.js`; any other script or external stylesheet fails the build.
- `apps/printor/scripts/budget.mjs` and `apps/glyph-art/scripts/budget.mjs` — each
  tool's `dist/assets/*.{js,css}` must stay under 300 KB gzip, and its
  `dist/index.html` must still contain `connect-src 'none'`. glyph art's also
  caps `dist/presets/` at 256 KB across every preset mark.
- `tests/privacy.test.ts` in **both** tools — `public/_headers` and `index.html`
  must keep `connect-src 'none'`, and no file under `src/` may contain
  `fetch`/`XMLHttpRequest`/`WebSocket`/`sendBeacon`/`EventSource` or
  `Math.random`. Comments are stripped before matching, so discussing these APIs
  in prose is fine.

All three apps are static and client-only: no endpoints, no telemetry, no remote
assets, no uploads. Adding any of those breaks the CSP tests. glyph art's preset
marks are the one thing loaded after the bundle, and they are same-origin images
under `img-src 'self'`, fetched by `<img>` — never by `fetch`.

## Repository layout

pnpm workspace (`apps/*`, `packages/*`):

- `apps/site/` — Eleventy v3 bilingual portfolio → `sazonov.space`.
- `apps/printor/` — Vite + React 19 + TypeScript + WebGL2 tool → `sazonov.space/printor/`.
- `apps/glyph-art/` — Vite + React 19 + TypeScript + canvas2d tool → `sazonov.space/glyph-art/`.
- `packages/tokens/tokens.css` — design tokens, read **by path** by `scripts/build-css.mjs`.
  It defines the dark palette only under `prefers-color-scheme`; the explicit
  `[data-theme]` overrides live in `apps/site/src/site.css`.
- `packages/shell/` — legacy shared tool shell. Nothing imports `@sazonov/shell` or
  `@sazonov/tokens` by package name anymore; each tool vendors its own copies in
  `apps/<tool>/src/shared/`. Editing `packages/shell/` affects nothing.

- `scripts/` — root build steps (CSS bundling, content lint, postbuild, budgets).
- `docs/decisions.md` — ADRs. New dependencies or spec deviations get an entry.
- `00-CONTEXT.md`, `01-SPEC-site.md`, `02-SPEC-printor.md`, `03-CONTENT.md` — product
  source of truth; read `00-CONTEXT.md` first.

**`src/shared/` is duplicated, not shared.** `tokens.css`, `shell.css`,
`Shell.tsx` and `theme.ts` are byte-identical copies in both tools. A change to
one has to be copied to the other by hand — there is no build step that does it.

**One repository, one Pages deployment.** `pnpm build` builds the site, builds
each tool, then `scripts/nest-tools.mjs` copies every `apps/<tool>/dist/` into
`apps/site/_site/<tool>/`. Each tool is built with its own Vite base
(`/printor/`, `/glyph-art/`); `PRINTOR_BASE=/` and `GLYPH_ART_BASE=/` override
them for a root domain. Anything referencing an asset at runtime must go through
`import.meta.env.BASE_URL` — a root-absolute path breaks the sub-path
deployment. Adding a tool means adding a row to `nest-tools.mjs`, an entry to
`apps/site/src/_data/tools.js`, and a build step to the root `build` script.

**Theme.** Three states — light, dark, system — shared across four documents on
one origin. The contract is one localStorage key, `sazonov-theme`, and one
attribute, `data-theme` on `<html>`; "system" stores nothing and stamps nothing.
The site applies it from `src/public/theme.js`, a blocking classic script; each
tool applies it in `main.tsx` before the first render. Changing the key or the
attribute means changing all of them.

## Generated files — never edit by hand

| Path | Produced by | From |
| --- | --- | --- |
| `apps/site/src/_includes/generated/styles.css` | `scripts/build-css.mjs` (lightningcss) | `packages/tokens/tokens.css` + `apps/site/src/site.css` |
| `apps/printor/src/generatedTextures.ts` | `apps/printor/scripts/generate-texture-library.mjs` | `apps/printor/public/textures/manifest.json` |
| `apps/glyph-art/src/generatedPresets.ts` | `scripts/build-glyph-presets.mjs` | `assets/glyph-presets/` (scans, not in git) |
| `apps/glyph-art/public/presets/` | `scripts/build-glyph-presets.mjs` | `assets/glyph-presets/` |
| `apps/printor/public/textures/` | `scripts/build-texture-library.mjs` | `assets/` (full-resolution scans, not in git) |
| `apps/site/_site/` | `eleventy` + `scripts/postbuild.mjs` | site sources |
| `apps/printor/dist/` | `vite build` + `apps/printor/scripts/postbuild.mjs` | printor sources |
| `apps/glyph-art/dist/` | `vite build` + `apps/glyph-art/scripts/postbuild.mjs` | glyph art sources |

The manifest-to-TypeScript generator runs before every printor `dev`, `lint`, and
`build`. To add a texture: drop the original in `assets/<group>/`, then run
`node scripts/build-texture-library.mjs` from the repo root. `assets/` is
gitignored — only the converted WebP library is committed.

`build-glyph-presets.mjs` works the same way and is likewise manual, because it
needs `assets/` which CI does not have. It converts each scan to an opaque grey
mark — black ink on white paper, whatever polarity the scan arrived in — and
re-solves the twelve-level ladder, so **adding one scan can move every level**.
`--sheet <dir>` renders each ladder as real blocks of stamped cells; look at
those before committing, because no table shows whether a ladder steps.

## printor architecture

Rendering is **one WebGL2 fragment shader, one draw call**. Nine stages run in a
fixed order that cannot be reordered:

`motion blur → soft paper → grain & gain → torn edges → wiggle → displacement
→ halftone → paper cuts → overlay`

Time is posterized before any of it: frame N is the source at `N / targetFps`
seconds (4..16 fps). A still source has no duration, so `settings.stillFrames`
sets the sequence length instead — `frameCount()` in `export/renderSequence.ts`
is the single place that decides, and both the preview and every export path go
through it.

**The central idea: every numeric parameter is a `Range`, not a value.** For each
frame the range collapses to one number drawn from `hash(seed, frame, stage,
channel)`. Texture stages hold a *pool* of library image ids and draw one per
frame. Each stage also has `frameChance`, the fraction of frames it runs on.
This is what makes consecutive frames differ while a seed still reproduces the
sequence exactly.

Data flow:

- `src/types.ts` — `Settings`, the stage model, `defaultSettings`. One schema
  for the whole app.
- `src/engine/frameParams.ts` — **all randomness lives here**, on the CPU.
  `resolveFrame(settings, frame)` returns finished scalars plus the texture id
  chosen for each stage. Unit-testable without a GL context.
- `src/engine/shaders.ts` — the GLSL. It receives resolved scalars and generates
  only *spatial* noise (grain, the torn-edge fbm), seeded by `u_seed`/`u_frame`.
- `src/engine/Renderer.ts` — GL context, five samplers (source + four stage
  textures), uniform upload. Caches which library texture each unit holds.
- `src/engine/textureCache.ts` — loads library images via `new Image()`. It must
  not use fetch: the CSP is `connect-src 'none'`.
- `src/export/renderSequence.ts` — the frame generator shared by both export
  paths; owns seeking and time posterization.
- `src/export/pngSequence.ts` — ZIP, one folder per ink pass.
- `src/export/mp4.ts` — WebCodecs H.264 via `mp4-muxer`; flat grayscale only.
- `src/projectState.ts` — validates untrusted project JSON against the defaults
  with per-parameter clamps, and base64url-encodes for share links.

**Adding a parameter touches five files in lockstep**: `types.ts` (field,
default, clamp in `projectState.ts`'s `limits`), `frameParams.ts` (draw it),
`shaders.ts` (uniform + use), `Renderer.ts` (upload), and
`components/StageInspector.tsx` (control). Missing one silently does nothing.

**Resolution independence.** Pixel-denominated settings are authored against
1080p and scaled by `u_pixel` (`canvas.height / 1080`). Without this the proxied
preview would show finer grain than the export. Any new pixel-based parameter
must multiply by `u_pixel`.

**Determinism rule.** No `Math.random()` anywhere — `tests/privacy.test.ts`
greps the whole `src/` tree for it, and for network APIs. Reroll advances the
seed with an LCG.

Output is strictly grayscale. Ink separation happens at write time: `u_ink`
selects flat, white-on-alpha, or black-on-alpha.

`main.tsx` routes `/support` to a separate `Support` component in the same
bundle; `scripts/postbuild.mjs` copies `index.html` to `dist/support/index.html`.
A service worker registers in production builds only.

## glyph art architecture

A raster is resampled onto a square grid, the grid is quantized into tone bands,
and each cell prints a mark. **Tone is carried by the size of the mark, never by
its colour.** Everything in the schema serves that one idea.

**A band stores a coverage target, not a size.** This is the decision the whole
tool rests on, and getting it wrong is invisible until the output looks bad.
Coverage grows as the square of size, so a linear tone→size map hands a
half-tone cell a quarter of its ink. Instead:

```
coverage c = 1.05 · tone ^ weight        authored curve, not photometric
density  ρ = measured ink fraction of the mark's tight box
size     s = sqrt( c / (ρ · min(a, 1/a)) )   long side, in cell units
```

Every mark — shipped SVG, typed character, uploaded file — is rasterized to
256 px and measured for ρ and aspect by the same code, because the solver cannot
run without ρ. See `docs/decisions.md`.

Data flow:

- `src/types.ts` — `Settings`, `Band`, `GlyphSpec`, `defaultSettings`. One schema.
- `src/engine/marks.ts` — the shipped `press` set as inline SVG. Densities are
  never hard-coded; they are measured like everything else.
- `src/engine/glyphLibrary.ts` — rasterize, measure ink (`alpha × (1 − luma)`),
  tight-box, cache. Loads through `<img>` and `FileReader`, never fetch.
- `src/engine/tone.ts` — box-average **in linear light**, band in **L\***,
  auto-levels from the 1st/99th percentile of the cell tones. Pure except for
  `sampleSource`.
- `src/engine/ramp.ts` — the coverage/size solve. Pure, unit-tested, no canvas.
- `src/engine/cellParams.ts` — `hand` jitter and cycle phase, hashed on the
  **cell, never the frame**; hashing on the frame makes the surface boil.
- `src/engine/render.ts` — one pass stamping marks into an alpha mask, then one
  `source-in` to colour it. The union in alpha is what makes overlapping ink
  idempotent and draw order irrelevant.
- `src/engine/halftone.ts` — the second mode end to end: rotated lattice, plate
  separation with GCR, dot area by shape. Everything above `HalftoneRenderer` is
  arithmetic and unit-tested without a canvas.
- `src/export/` — same three files as printor, same shapes. `pngSequence` also
  writes one folder per separation plate when a halftone asks for it.
- `src/projectState.ts` — validates untrusted project JSON; share links strip
  uploaded marks and substitute the shipped mark of the same band.

**Adding a parameter touches four files in lockstep**: `types.ts` (field +
default), `projectState.ts` (clamp), the engine module that consumes it, and the
control in `App.tsx` or `components/RampEditor.tsx`.

**Two modes, one tone field.** `settings.mode` is `glyph` or `halftone`, and
they share only `engine/tone.ts`. A halftone has no cells and no marks: it is a
frame-independent lattice at its own ruling and angle, tone is the *area* of a
dot, and colour comes from screening separate plates 30° apart rather than from
tinting one ink. `engine/halftone.ts` owns all of it; the bands, the ramp
editor, the seed, `hand` and the cycling controls are hidden in that mode
because none of them mean anything there. `sequenceSize` decides the frame for
both modes — the renderer must never re-derive it from the tone field, or the
preview and the H.264 encoder disagree by a pixel or two.

**`peak` and `maxSize` are settings, not constants.** `peak` is the ink the
darkest band asks for and `maxSize` is how far a mark may spill past its cell
(nothing is ever clipped — marks stamp into a full-frame mask). `fitPeak` solves
`peak` from `maxSize` across **every band and every pool member**; fitting on the
darkest band alone leaves a sparse mark mid-ladder clamped, which is the failure
`fit ramp` exists to prevent.

**Presets are generated.** `generatedPresets.ts` carries four sets of scanned
period marks and the twelve-level ladder solved for each, plus the ink density
and proportion measured at build time. Those numbers are for tests and
documentation only — the browser re-measures every mark on load and *that* is
what the renderer uses; the two agree to a fraction of a percent, not exactly,
because the browser re-rasterizes to 256 px first. `src/presets.ts` is the
hand-written part: applying a preset changes the marks, the band count, `peak`
and `maxSize`, and deliberately nothing about the picture. `projectState.ts`
accepts a preset mark by **id membership** in `presetGlyphIds` and takes its
path from this build, never from the file — a project file is untrusted input
and that path goes straight into an `<img>`.

**The preview is the export.** The raster is `grid × cellPixels(grid)`, derived
from the grid rather than the source, so there is no proxy and none of printor's
`u_pixel` class of preview/export mismatch. `cellPixels` returns an even number
so H.264 never has to resize the frame.

Same determinism rule as printor: no `Math.random()`, reroll advances the seed
with an LCG, `tests/privacy.test.ts` greps for both.

## Site architecture

Eleventy v3 with Nunjucks. Deliberately small, but no longer two pages: the
header carries Tools, Articles and About, and the home page lists the tools and
the newest articles.

Routes, in full: `/`, `/about/`, `/tools/`, `/articles/`, `/articles/printor/`,
`/articles/glyph-art/` and the same six under `/ru/`, plus `/404.html`,
`/sitemap.xml`, `/robots.txt`, and the passthrough files in `src/public/`
(`CNAME`, `_headers`, `favicon.svg`, `theme.js`). Translations are linked with
`translationUrl` in front matter, which drives the `hreflang` tags.

Articles are Markdown under `apps/site/src/content/{en,ru}/articles/`, with a
directory data file setting the layout, language, tag (`articlesEn` /
`articlesRu`) and permalink. `scripts/lint-content.mjs` enforces `lang: en|ru`,
a `title`, and a `description` of at most 160 characters on all of it.

The site ships exactly one script, `src/public/theme.js`, loaded blocking from
`<head>` so the theme lands before first paint. Its CSP is `script-src 'self'`;
everything else stays locked down, including `connect-src 'none'`.

`tests/site.test.mjs` asserts every route builds, that the removed routes
(`/posts/`, `/projects/`, `/cv/`) stay removed, that the homepage loads
`/theme.js` and nothing else, that both about pages keep their outside links and
the CV, that the theme toggle and its CSS overrides are present, and that both
tools are nested and base-aware.

Editing entry points: `apps/site/src/_data/site.js` (name in both languages,
contact links), `_data/navigation.js` (header links), `_data/tools.js` (tool
URLs, status and article links, which drive the home page, the tools index and
the footer), `src/logo.svg` (auto-optimized inline logo), `docs/main.pdf`
(published as `/cv.pdf` and linked from about).

## Conventions

- TypeScript throughout. All identifiers, comments, UI strings, commits, and docs in
  English; Russian prose only under `src/content/ru/`.
- `camelCase` values, `PascalCase` components and types, kebab-case content slugs.
- Two-space indentation.
- Always spell `printor` lowercase. Same for `glyph art` — two words with a real
  space in prose and in the UI; the hyphen belongs to the URL and the slug only.
- Reuse tokens rather than hardcoding palette or spacing values.
- Conventional Commits, e.g. `feat(printor): add paper banding controls`.
