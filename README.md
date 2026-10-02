# sazonov.space

A monorepo for Stepan Sazonov's bilingual site and local-first creative tools.

- `apps/site/` — Eleventy portfolio deployed to `sazonov.space`.
- `apps/printor/` — React/WebGL2 application deployed to
  `sazonov.space/printor/`.
- `apps/glyph-art/` — local image/video glyph renderer, spatial step gradients,
  grid keyframes and editable SVG at `sazonov.space/glyph-art/`.
- `packages/tokens/` — shared monochrome design tokens.
- `packages/shell/` — reusable shell for browser tools.

## Development

```sh
pnpm install
pnpm dev:site
pnpm dev:printor
pnpm dev:glyph-art
```

Run `pnpm check` before submitting changes. `pnpm build` writes the portfolio to
`apps/site/_site/` and nests printor and glyph art beneath their tool paths, so
one Pages deployment serves all three. The build fails when the compressed
English homepage exceeds 14,336 bytes or either tool exceeds 300 KB gzip.

## Configuration

The default production origin is `https://sazonov.space`. Override it during a
preview build when needed:

```sh
SITE_URL=https://preview.example.com pnpm build
```

The owner's SVG logo lives at `apps/site/src/logo.svg`; the approved CV is
`docs/main.pdf`. Confirmed contact links belong in
`apps/site/src/_data/site.js`.

## Content

The site is a home page and an about page in English and Russian — four pages
total. Both about pages are hand-written templates, not Markdown; edit
`apps/site/src/about.njk` and `apps/site/src/ru/about.njk` directly.

Code is licensed under AGPL-3.0-only. Site prose remains the copyright of
Stepan Sazonov.

Glyph art's counter alphabet is a modified Roboto Medium subset, distributed
as vector paths under Apache-2.0; attribution is in
`apps/glyph-art/public/licenses/roboto.txt`. No font is loaded at runtime.
See [the regeneration notes](docs/glyph-art-reactions.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for editing guidance and
[`docs/publishing/README.md`](docs/publishing/README.md) for GitHub,
Cloudflare Pages, and DNS setup.
