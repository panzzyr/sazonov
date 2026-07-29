# sazonov.space

A monorepo for Stepan Sazonov's bilingual portfolio and local-first creative
tools.

- `apps/site/` — Eleventy portfolio deployed to `sazonov.space`.
- `apps/printor/` — React/WebGL2 application deployed to
  `printor.sazonov.space`.
- `packages/tokens/` — shared monochrome design tokens.
- `packages/shell/` — reusable shell for browser tools.

## Development

```sh
pnpm install
pnpm dev:site
pnpm dev:printor
```

Run `pnpm check` before submitting changes. Production output is written to
`apps/site/_site/` and `apps/printor/dist/`. The build fails when the compressed
English homepage exceeds 14,336 bytes.

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

English and Russian content lives under `apps/site/src/content/`. A post is one
Markdown file with front matter; set `draft: true` to exclude it from a normal
build. `pnpm build:drafts` includes draft material.

Code is licensed under AGPL-3.0-only. Site prose remains the copyright of
Stepan Sazonov.

See [CONTRIBUTING.md](CONTRIBUTING.md) for editing guidance and
[`docs/publishing/README.md`](docs/publishing/README.md) for GitHub,
Cloudflare Pages, and DNS setup.
