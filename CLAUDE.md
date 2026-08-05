# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 22 and pnpm 10.24.0 (`packageManager` is pinned; CI uses `--frozen-lockfile`).

```sh
pnpm install
pnpm dev:site        # Eleventy at http://localhost:8080
pnpm dev:printor     # Vite at http://127.0.0.1:5173
pnpm check           # lint && build && test — the gate CI runs
```

`pnpm check` expands to `pnpm lint` (content lint + `tsc --noEmit`), `pnpm build`
(both apps plus the size/CSP budgets), then `pnpm test`.

**Test order matters.** `node --test tests/*.test.mjs` asserts against generated
HTML in `apps/site/_site/`, so `pnpm test` only passes after a build. Run
`pnpm build` first, or just use `pnpm check`.

Per-app and single-test invocations:

```sh
pnpm --filter @sazonov/printor test              # vitest run
pnpm --filter @sazonov/printor exec vitest run tests/shader.test.ts
pnpm --filter @sazonov/printor exec vitest run -t "deterministic"
pnpm --filter @sazonov/printor lint              # generates textures, then tsc --noEmit
node --test tests/site.test.mjs                  # single site test file (needs a site build)
pnpm build:drafts                                # site build including draft: true content
SITE_URL=https://preview.example.com pnpm build  # override production origin
```

## Hard constraints enforced by the build

These fail the build, not just a lint warning:

- `scripts/budget.mjs` — Brotli-compressed `apps/site/_site/index.html` must stay
  under 14,336 bytes. The homepage inlines all CSS and ships no `<script>`.
- `apps/printor/scripts/budget.mjs` — printor's `dist/assets/*.{js,css}` must stay
  under 300 KB gzip, and `dist/index.html` must still contain `connect-src 'none'`.
- `tests/privacy.test.ts` (printor) — `public/_headers` must keep `connect-src 'none'`
  and `App.tsx`/`main.tsx`/`store.ts`/`projectState.ts` must contain no
  `fetch`/`XMLHttpRequest`/`WebSocket`.

Both apps are static and client-only: no endpoints, no telemetry, no remote assets,
no uploads. Adding any of those breaks the CSP tests.

## Repository layout

pnpm workspace (`apps/*`, `packages/*`):

- `apps/site/` — Eleventy v3 bilingual portfolio → `sazonov.space`.
- `apps/printor/` — Vite + React 19 + TypeScript + WebGL2 tool → `sazonov.space/printor/`.
- `packages/tokens/tokens.css` — design tokens, read **by path** by `scripts/build-css.mjs`.
- `packages/shell/` — legacy shared tool shell. Nothing imports `@sazonov/shell` or
  `@sazonov/tokens` by package name anymore; printor vendors its own copies in
  `apps/printor/src/shared/`. Editing `packages/shell/` does not affect printor.
- `scripts/` — root build steps (CSS bundling, content lint, postbuild, budgets).
- `docs/decisions.md` — ADRs. New dependencies or spec deviations get an entry.
- `00-CONTEXT.md`, `01-SPEC-site.md`, `02-SPEC-printor.md`, `03-CONTENT.md` — product
  source of truth; read `00-CONTEXT.md` first.
**One repository, one Pages deployment.** `pnpm build` builds the site, builds
printor, then `scripts/nest-printor.mjs` copies `apps/printor/dist/` into
`apps/site/_site/printor/`. printor is built with Vite `base: "/printor/"`;
`PRINTOR_BASE=/` overrides it for a root domain. Anything referencing an asset
at runtime must go through `import.meta.env.BASE_URL` — a root-absolute path
breaks the sub-path deployment.

## Generated files — never edit by hand

| Path | Produced by | From |
| --- | --- | --- |
| `apps/site/src/_includes/generated/styles.css` | `scripts/build-css.mjs` (lightningcss) | `packages/tokens/tokens.css` + `apps/site/src/site.css` |
| `apps/printor/src/generatedTextures.ts` | `apps/printor/scripts/generate-texture-library.mjs` | `apps/printor/public/textures/manifest.json` |
| `apps/printor/public/textures/` | `scripts/build-texture-library.mjs` | `assets/` (full-resolution scans, not in git) |
| `apps/site/_site/` | `eleventy` + `scripts/postbuild.mjs` | site sources |
| `apps/printor/dist/` | `vite build` + `apps/printor/scripts/postbuild.mjs` | printor sources |

The manifest-to-TypeScript generator runs before every printor `dev`, `lint`, and
`build`. To add a texture: drop the original in `assets/<group>/`, then run
`node scripts/build-texture-library.mjs` from the repo root. `assets/` is
gitignored — only the converted WebP library is committed.

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

## Site architecture

Eleventy v3 with Nunjucks. `eleventy.config.js` adds a markdown-it plugin that
renders `$…$` and `$$…$$` through Temml (MathML, no client-side JS), an HTML
minifier transform, and the collections/filters the templates use.

Content lives in `apps/site/src/content/{en,ru}/{posts,projects}/`, one Markdown file
per item. Routes mirror: `/posts/slug/` and `/ru/posts/slug/`. Translations share a
`slug` and are linked with `translationUrl` in front matter, which drives the
`hreflang` tags. `draft: true` excludes a file unless `BUILD_DRAFTS=1`.

`scripts/lint-content.mjs` requires front matter with `lang: en|ru`, a `title`, and a
`description` of at most 160 characters.

`tests/site.test.mjs` asserts EN/RU route parity, that the homepage carries no
`<script>` or external stylesheet, that translations exist, and that drafts stay out.

Editing entry points: `apps/site/src/_data/site.js` (contact links),
`_data/tools.js` (tool URLs and status), `src/logo.svg` (auto-optimized inline logo),
`docs/main.pdf` (published as `/cv.pdf`).

## Conventions

- TypeScript throughout. All identifiers, comments, UI strings, commits, and docs in
  English; Russian prose only under `src/content/ru/`.
- `camelCase` values, `PascalCase` components and types, kebab-case content slugs.
- Two-space indentation.
- Always spell `printor` lowercase.
- Reuse tokens rather than hardcoding palette or spacing values.
- Conventional Commits, e.g. `feat(printor): add paper banding controls`.
