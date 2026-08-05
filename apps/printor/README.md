# printor

printor turns video into frames that look printed on a bad printer and then
scanned back in. Everything runs locally in WebGL2; source files are never
uploaded and the app makes no network requests at all.

## Run locally

```sh
pnpm install
pnpm dev
```

Open `http://127.0.0.1:5173`. Drop in a video or a still image.

`space` plays, arrow keys step frames, `\` compares with the source, `r`
rerolls the seed, and `e` exports.

## The pipeline

Time is posterized first: the source is sampled at the target frame rate (4–16
fps), so a 24 fps clip exported at 8 fps holds each frame for three source
frames. Then every output frame runs through nine stages, in this fixed order:

| # | Stage | What it does |
| --- | --- | --- |
| 1 | motion blur | Directional smear; blur distance and angle |
| 2 | soft paper | Paper stock blended under the print |
| 3 | grain & gain | Noise and contrast feeding the threshold |
| 4 | torn edges | The silkscreen threshold — balance, smoothness, contrast, roughness |
| 5 | wiggle | Whole-frame registration drift |
| 6 | displacement | Warps the frame using a paper texture as a height map |
| 7 | halftone | Procedural rotated dot screen |
| 8 | paper cuts | Torn paper shapes used as an alpha mask |
| 9 | overlay | Hard paper stock laid over the finished print |

Each stage can be switched off, and each has an **applied on N% of frames**
control so a stage can hit, say, 40% of frames at random.

**Every numeric parameter is a range, not a value.** For each frame the range
collapses to one number drawn from `hash(seed, frame, stage, channel)`. Texture
stages work the same way: you select a pool of library images and each frame
draws one. That is what makes every frame print differently while a given seed
still reproduces the sequence exactly.

Stages 5 and 6 come after the threshold but are applied by shifting the
sampling coordinate the upstream stages read from, which is equivalent and
keeps the whole pipeline to one draw call.

### Torn edges

This is the stage the look depends on. It is Photoshop's *Torn Edges* rather
than a dither: grain and gain break the tone into speckle, then a low-frequency
fbm pushes luminance across the balance point so the boundary tears along
paper-fibre shapes instead of cutting a clean line.

- **image balance** — where the threshold sits; lower keeps more ink
- **smoothness** — size of the torn fibre; low is frayed, high is a calm coastline
- **contrast** — hardness of the edge
- **roughness** — how far the edge may wander from the true outline

Grain feeds this stage, so tune grain and gain first.

## Output

Frames are strictly grayscale. Export is either:

- **PNG sequence (ZIP)** with any combination of three passes — flat grayscale,
  white ink (black keyed to alpha), and black ink (white keyed to alpha). Each
  pass lands in its own folder. Combined with the global **invert** toggle this
  covers all four ink variants.
- **MP4** at the target frame rate, via WebCodecs. H.264 carries no alpha, so
  MP4 is always the flat grayscale result.

Preview and export share the same shader and the same per-frame parameters, and
pixel-denominated settings are authored against 1080p, so the proxied preview
shows the same print as the full-resolution export.

## Texture library

The committed library under `public/textures/` is generated from full-resolution
scans that live outside the repository:

```sh
node ../../scripts/build-texture-library.mjs --force
```

It reads `<repo>/assets/{soft paper texture,hard paper texture,paper parts}/`
and writes 2048 px WebP plus a manifest. Cutouts are reduced to their alpha
channel, since they are only used as masks. `scripts/generate-texture-library.mjs`
then bakes the manifest into `src/generatedTextures.ts` — the app ships
`connect-src 'none'`, so it cannot fetch a manifest at runtime.

Groups map to stages: `soft-paper` → soft paper, `hard-paper` → displacement and
overlay, `paper-parts` → paper cuts.

## Build and test

```sh
pnpm lint
pnpm test
pnpm build
```

`dist/assets/*.{js,css}` must stay under 300 KB gzip and `dist/index.html` must
keep `connect-src 'none'`; `scripts/budget.mjs` fails the build otherwise.

## Publish

printor ships as part of the portfolio deployment at `sazonov.space/printor/`,
not as its own site. From the repository root, `pnpm build` builds both and
nests this app's `dist/` into `apps/site/_site/printor/`.

The base path is baked in at build time (`base: "/printor/"` in
`vite.config.ts`). Build with `PRINTOR_BASE=/ pnpm build` to serve it from a
root domain instead. Runtime asset lookups go through `import.meta.env.BASE_URL`,
so they follow whichever base was used.

See `docs/publishing/README.md` for the Pages and DNS setup.
