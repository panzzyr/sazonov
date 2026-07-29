# printor

printor turns video or still images into printed-and-scanned frames. Processing
runs locally in WebGL2; files are never uploaded.

## Run locally

From the repository root:

```sh
pnpm install
pnpm dev:printor
```

Open `http://127.0.0.1:5173`. Drop an MP4, MOV, WebM, GIF, PNG, JPEG, or WebP
onto the canvas. Use the layer list to reorder effects, select a layer to edit
its controls, and export a PNG sequence as ZIP.

Keyboard shortcuts:

- `space` — play or pause video
- `←` / `→` — step one output frame
- `shift` + `←` / `→` — step ten frames
- `\` — hold to compare with the source
- `r` — reroll the deterministic seed
- `e` — export

## Build and test

```sh
pnpm --filter @sazonov/printor build
pnpm --filter @sazonov/printor test
```

Production files are written to `apps/printor/dist/`.

## Architecture

The source frame is uploaded to a WebGL2 texture. A single fragment shader
applies reorderable logical passes for levels, noise, dither/halftone, and
paper artifacts. Every varying value is derived from
`hash(seed, frame, layer, channel)`; the pipeline never calls `Math.random()`.
PNG export renders the same shader at source resolution and includes the preset
as `printor.json` in the ZIP.

The baseline release intentionally ships universal PNG ZIP export first.
WebCodecs encoding, worker rendering, additional passes, and user textures are
the next milestones.
