---
lang: en
title: glyph art
description: "How to use glyph art — turn an image or a video into a grid of glyphs whose size carries the tone of each cell."
date: 2026-08-09
tool: glyph-art
translationUrl: /ru/articles/glyph-art/
englishUrl: /articles/glyph-art/
---

glyph art splits an image or a video into a grid of cells, measures the tone of
each cell, and draws one glyph in its place. The size of the glyph is what
carries the tone: a dot where the cell is quietest, a heavy mark where it is
loudest. It is ASCII art with size doing the work instead of the choice of
character.

It runs entirely in your browser. Files you open stay on your machine — the page
is not allowed to make network requests at all.

If something will not open, the [browser check](/glyph-art/support/) reports
which capabilities you have.

## Load a source

Drop a file anywhere on the canvas, or use the drop zone in the source panel.
It reads MP4, MOV, WebM, PNG, JPEG and WebP. SVG works for marks but not as a
source — browsers will not reliably decode one into a bitmap.

Decoding is the browser's job. If an MP4 or MOV will not open, convert it to
H.264 or export an image sequence from your editor instead.

The output raster is worked out from the grid, not from the source: at 72 cells
across, the frame comes out 1728 px wide. That means the canvas you are looking
at *is* the exported frame, at full size, scaled down only by your screen. There
is no separate preview quality to get wrong.

## The grid

`cells` is how many cells fit across the width, from 8 to 240. The height
follows the source's own proportions. 72 is a good place to start: a face
survives at 72, becomes an abstraction near 48, and turns into texture past 120.
Below about eight pixels per cell the marks stop reading as marks and you are
better off with [printor](/printor/); the panel tells you when you get there.

`hand` loosens the grid. It is one knob covering three things at once — a small
rotation, a small offset and a small size change, drawn separately for every
cell. At 0 the result is a machine. Around 0.35 it reads hand-stamped.

The important part is that `hand` is drawn per **cell**, not per frame. It stays
put while the sequence plays. If it were redrawn every frame the whole surface
would boil, which looks like noise rather than like a hand.

## Tone

Three controls decide which band a cell lands in.

`levels` is a black point and a white point. It is set automatically when you
load a source, from the 1st and 99th percentile of the cell tones — a flat photo
quantized into seven bands only uses four of them and looks dead, so this
happens before you see anything. Drag the two thumbs to override it. If the
source is genuinely flat, the automatic pass leaves it alone rather than
amplifying noise.

`bands` is how many tones the image is cut into, from 2 to 24. Three is a
poster, twelve is a halftone, seven is a ladder where you can count every rung.
Changing the count stretches the ramp you already built rather than resetting
it.

`weight` bends the whole ramp at once. Lower prints heavier, higher prints
lighter and airier. It is the second most useful control after `levels`, and the
tone ramp updates live so you can see what it is doing.

Tones are averaged in linear light and banded in perceptual lightness. That is
not a detail you have to care about, but it is the reason the midtones do not
clog the way they do in most tools of this kind.

## The tone ramp

The strip along the bottom is the tool. One column per band, lightest on the
left, darkest on the right.

Each column shows its mark **at the size it will actually print**, relative to
the cell. Read the wells left to right and you are looking at the tone curve
itself.

The number under each well is that size as a percentage of the cell. Anything
over 100% overflows into its neighbours, which is deliberate: the darkest band
has to overflow or the shadows break into polka dots instead of holding together
as mass.

- Band 0 is empty by default and reads `paper`. Paper is a value, and keeping
  the lightest band blank is most of what makes a first drop look like a print.
- Drag a column's slider to set that band's size by hand. A `·` appears next to
  the number to say it is no longer on the curve. `rebalance` puts every band
  back.
- A `!` in the corner of a well means the mark is too sparse to reach that
  band's tone even at full size.

### Why the size is not simply the tone

Because ink coverage grows as the square of size. Map tone straight to size and
a cell at half tone gets a quarter of the ink it should; midtones wash out and
shadows slam shut.

So each band asks for a fraction of its cell to be *inked*, and the size is
solved backwards from that target and the mark's own ink density, which is
measured when the mark is loaded. This is what lets a dot, an X and a solid
square sit on one ramp without any of them reading two bands off.

## Marks

Six marks ship with the tool — a point, a cross, a saltire, a frame, a ring and
a blot — spread across the bands, with the lightest band left as paper.

`load a set` in the marks panel takes several PNG, JPEG, SVG or WebP files at
once and spreads them across the bands in file order. That is the fast path from
a folder of drawings to a working ramp.

To place marks one at a time, drop files straight onto a band's column in the
ramp, or use the `+` button in it. Several files dropped on one column all go to
that band, where they cycle. Click a mark's chip to take it off the band.

To use letters, type characters into the `marks` field, pick a font, and press
`add`. Each character becomes one mark, and they go onto whichever band is
selected. Click a column to select it.

An uploaded file is read as ink, not as a picture: white backgrounds contribute
nothing and transparency is respected, so a black-on-white scan needs no
preparation.

## Making it move

A still with one mark per band produces one frame, because nothing about it
changes. Motion comes from putting **more than one mark on a band**.

When a band holds several marks they cycle. `hold` is how many frames each mark
is held for, 1 to 24, and the panel shows what that works out to in marks per
second at the current frame rate.

Cells within a band are deliberately out of phase with each other, so the
surface simmers rather than flipping over all at once. Lockstep would read as a
slideshow of two pictures; at `hold` 1 it would strobe.

Marks sharing a band should be variations of the same mark — three drawings of
the same X, not three unrelated shapes. Unrelated shapes on random phase is
television static. Their tone stays even as they cycle: each one is resized to
print the same coverage as the band's first mark.

For a still, `frames` sets the sequence length and `seamless loop` sets it to
the shortest length where every band's cycle lines up again.

For a video, the length comes from the clip. `frame rate` posterizes time to
between 4 and 16 fps: frame N is whatever the source shows at N ÷ frame rate
seconds, held, not blended.

## Colour and inverting

`mono` prints one ink on paper. `source colour` fills each mark with the average
colour of its own cell, so the piece keeps the source's colour while tone is
still carried entirely by size.

There are two separate inversions and they do different things:

- `invert colour` swaps the ink and the paper. White marks on black.
- `invert ramp` reverses which band a tone lands on, so the heavy marks print on
  the bright cells and the light marks on the dark ones. The ramp you built
  stays exactly as it is; only the mapping into it flips.

## Export

`png` writes a ZIP with one PNG per frame, and can carry three passes at once,
each in its own folder:

- `flat` — marks over paper, opaque.
- `marks → alpha` — the marks only, paper transparent.
- `paper → alpha` — the paper only, with the marks punched out of it.

Together with `invert colour` that covers all four variants. A `README.txt` in
the ZIP records the frame rate, the grid, the band count and the seed.

`mp4` writes H.264 at the target frame rate. H.264 has no alpha channel, so MP4
is always the flat result. The frame is never resized on the way out.

Export stops at 900 frames.

## Seed, projects, keyboard

`seed` drives every per-cell draw — the `hand` jitter and the cycle phases. The
same seed reproduces a piece exactly; `reroll` moves to the next one. Nothing in
the tool uses unseeded randomness.

`save` writes a project file with your marks embedded in it. `share` puts the
settings in the address bar — uploaded marks are too large for a URL, so a share
link substitutes the shipped mark for them and says so. Use the project file if
you want to keep your own marks.

Keyboard: space plays and pauses, the arrow keys step a frame, holding `\` shows
the source underneath, and ⌘Z / ⇧⌘Z undo and redo.
