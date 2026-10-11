# Glyph appearance and background cleanup

## Appearance / blend

Enable **animate appearance** on the right. A one-frame still becomes a
four-second clip in one undoable edit; existing clip lengths are preserved.
Choose **scatter / matrix** under symbol motion below for independent symbol changes.
Blend does not change the grid, mark size, source video, or symbol selection.
The background remains plain paper (black with white ink when colour is inverted);
the original photo/video is never embedded underneath.

- **Appear at / over:** start time and duration, in seconds. Cell onsets are
  independently staggered over the interval, using the layout seed.
- **Disappear afterwards:** optional departure phase with its own start/duration.
  Turn it off for a reveal that stays visible. Overlapping phases deliberately
  multiply their envelopes; a warning explains incomplete appearances.
- **Per-symbol fade:** opacity transition per cell, capped by the phase duration.
  Set to zero for instant switches. If fade fills the entire phase, onsets
  coincide; reduce it for more staggering.
- **Departure:** same order as appearance, reverse order, or independently random.
- **Fit appearance to clip:** divide the available frame time into appearance,
  hold, and departure thirds, ending with an empty final frame when departure is enabled. Changing FPS
  changes clip duration; this button explicitly fits the timings again.

The clip's last sampled time is `(frames - 1) / fps`, not `frames / fps`.
Out-of-clip intervals produce a warning, not a hidden change to the user's timing.
An empty first and last frame close the appearance seam. A fixed-grid still can
also use the existing scatter loop. Sparse scatter may leave some symbols static;
infinite hold freezes the picks while the appearance envelope still runs.
At low FPS or high cell counts, multiple scheduled events can land on one frame.

Shuffle uses the symbol seed and does not reorder appearance. Reroll/layout seed
does. Timing is stateless, so scrubbing backwards and exporting agree. Grid
keyframes remain supported, but changing cell identities changes their schedules;
use a fixed grid for stable choreography.

PNG, MP4 and preview stamp the same prepared vector with per-cell alpha. SVG
exports the visible current frame: opaque outlines are gathered by ink, and
partial outlines are separate filled paths with `fill-opacity`. Keeping them
separate preserves overlapping alpha; there is no new trace or raster embedding.
Fading SVGs can have more editable objects. Source-colour mode retains its existing
per-cell-mask versus per-impression SVG colouring distinction at spilling edges.

## Background cleanup

In the left panel, turn on **remove black background** and/or **remove white
background**. Each filter has a tolerance in perceptual source lightness.
Zero removes only exact black/white; start around 2% for near-solid/compressed
backgrounds and raise cautiously. Clipping applies to the averaged source cell,
before levels, tone selection and either inversion. It is not an automatic
background segmentation: matching foreground cells are removed as well.

**Minimum mark** suppresses marks whose longest dimension is below the chosen
percentage of a cell, after density correction and hand jitter. It works on the
whole artwork, so it can also remove thin highlights. The default 5% is the old
renderer cutoff. All presets, gradients and glyph export formats use exactly the
same filters. Both features are glyph-only; halftone rendering is unchanged.

Legacy projects default to appearance off and both background filters off.
Project files, local autosave, share links and undo/redo preserve the new settings.
No modules were installed, and no source media leaves the browser.

Clip timing, appearance and symbol motion are separate right-panel blocks.
Advanced seeds are collapsed; shuffle remains in the transport. A preset picker
closes after a choice and shows the selected collection in its summary, leaving
the grid, tone and cleanup controls easier to reach.
