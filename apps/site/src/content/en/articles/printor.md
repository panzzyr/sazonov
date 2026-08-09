---
lang: en
title: printor
description: "How to use printor — load a source, set the frame rate, work through the nine stages, and export PNG passes or MP4."
date: 2026-07-12
tool: printor
translationUrl: /ru/articles/printor/
englishUrl: /articles/printor/
---

printor takes a video or a still image and prints it. Each frame is thresholded
to black and white, dragged across a paper scan, knocked out of registration and
torn at the edges. The output is grayscale and looks like something that was
printed and then scanned back in.

It runs entirely in your browser. Files you open stay on your machine — the page
is not allowed to make network requests at all.

You need WebGL2. If the canvas stays empty, open the
[browser check](/printor/support/); it reports which capabilities you have.

## Load a source

Drop a file onto the canvas, or click the drop zone and pick one. printor reads
MP4, MOV, WebM, PNG, JPEG and WebP. A GIF opens as its first decoded frame.

Decoding is the browser's job, not printor's. If an MP4 or MOV will not open,
convert it to H.264 or export an image sequence from your editor instead.

The preview is scaled down to 900 px on the long edge so scrubbing stays fast.
Export renders at the source resolution.

## Frame rate

`frame rate` sets the output rate, 4 to 16 fps. Time is posterized to it before
anything else happens: frame N is whatever the source shows at N / frame rate
seconds. A 24 fps clip exported at 8 fps holds each sampled frame for three
frames' worth of time — it does not blend them. That step is most of what makes
the result read as printed rather than as a filter over smooth motion.

The length of a video sequence is its duration times the frame rate.

## Stills

A still has no duration, so there is nothing to sample. `frames` sets the length
of the sequence instead, from 1 to 240, and appears only when the source is an
image. The source never changes; every frame differs because every parameter is
redrawn. The panel shows the resulting duration at your frame rate.

## Every parameter is a range

Understand this before touching any slider.

Almost every control has two handles, a minimum and a maximum, not one value.
For each frame printor draws a number from inside that range using
hash(seed, frame, stage, parameter). Set `blur` to 2–14 px and frame 1 might get
3.1 px while frame 2 gets 11.8 px. Pull the handles together and the parameter
becomes a constant.

Textures work the same way. A texture stage does not hold one image, it holds a
pool. Select ten sheets and each frame picks one of them. Selecting more widens
the variation; it does not layer them.

The draw is deterministic. The same seed, frame number and settings always give
the same number, which is why the preview and the export agree exactly.

## frame chance

Every stage has `applied on N% of frames` at the top of its inspector. At 100%
the stage runs on every frame. At 40% it runs on roughly two frames in five,
decided per frame and stable for a given seed. This is how you get a stage that
flickers in and out — an overlay sheet that lands on some frames and not others.

Out of the box `displacement` runs on 60% of frames and `overlay` on 40%.
`halftone` and `paper cuts` are switched off entirely.

## The nine stages

They run in this order and the order is fixed. It matters: grain feeds the
threshold, and the paper cuts land on the finished print rather than on the
source.

1. **motion blur** — a directional smear on the source frame. `blur` is the
   length in pixels, `angle` the direction, `samples` how many taps the smear is
   built from. `blur both directions` smears symmetrically instead of trailing.
2. **soft paper** — a soft paper scan laid under the print. Pick your textures,
   then set `scale` (100% fits the frame), `rotation`, `offset` (distance from
   centre as a fraction of the frame; the direction is redrawn each frame),
   `opacity`, and the `blend` mode — multiply, screen, overlay or softlight.
3. **grain & gain** — noise and contrast pushed into the threshold. `grain` is
   what speckles the fill. `gain` is contrast: the higher it goes, the fewer
   mid-tones survive the next stage. `grain size` is the noise cell in pixels,
   where 1 is per-pixel.
4. **torn edges** — the threshold itself, and the stage that actually makes the
   print. `image balance` is where the cut sits; lower keeps more ink.
   `smoothness` sets the size of the torn fibre — low is frayed, high is a calm
   coastline. `contrast` is the hardness of the edge. `roughness` is how far the
   edge may wander from the true outline.
5. **wiggle** — whole-frame registration drift, like a sheet fed crooked.
   `shift` is the distance in pixels, with a new direction each frame;
   `rotation` is a small tilt in degrees.
6. **displacement** — warps the frame using a hard paper scan as a height map.
   `amount` is the peak warp in pixels and the slope of the map decides the
   direction. Placement works as it does for soft paper.
7. **halftone** — a procedural rotated dot screen. `cell` is the pitch in
   pixels: small reads as a fine print, large as a poster. `angle` rotates the
   screen and `strength` mixes it in. Off by default.
8. **paper cuts** — torn paper shapes used as a mask, so parts of the frame are
   cut away. `feather` softens the edge. `invert mask` punches a hole where the
   shape is instead of keeping it. Off by default.
9. **overlay** — a hard paper sheet laid over the finished print. Same controls
   as soft paper, screen blend by default.

Pixel-denominated settings are authored against 1080p and scaled to the frame
you are working at, so the downscaled preview shows the same grain size as a 4K
export.

## Seed and reroll

The button in the output panel shows the current `seed`. Click it, or press R,
to advance it. Every random draw in the sequence changes at once: same settings,
different take. Nothing you set by hand moves.

Undo and redo cover parameter edits (Cmd/Ctrl+Z, add Shift to redo). `reset`
returns everything to the defaults.

## Watching it

Hold `\` to see the untouched source. Left and right arrows step one frame,
Shift with an arrow steps ten. Space plays and pauses a video. Playback steps
whole output frames at the target rate, so what you watch is what you get.

## Export

`invert` flips the finished grayscale frame. It applies to everything you
export.

**PNG sequence** writes a ZIP. Choose any combination of three passes:

- grayscale — opaque black and white.
- white ink — the white kept, black turned into transparency.
- black ink — the black kept, white turned into transparency.

With more than one pass selected each lands in its own folder, so you can import
them as separate layers. A README.txt in the ZIP records the frame count, frame
rate and seed. Together with `invert` the three passes cover all four ink
variants.

**MP4** encodes H.264 through the browser's WebCodecs encoder at the target
frame rate. H.264 has no alpha channel, so MP4 is always the flat grayscale
result and the ink passes stay PNG-only. The button is disabled if your browser
has no encoder.

Export stops at 900 frames. A longer source is truncated and the panel says so
before you start.

## Saving and sharing

Settings are written to your browser's local storage as you work, so the tool
reopens where you left it. `save .json` downloads the project and `load` reads
one back. `share link` copies a URL with the settings packed into the fragment —
it carries settings only, never your media.
