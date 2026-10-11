# Long timelines and exports

Uploading a video never imposed a duration limit. The old renderer stopped its
preview/export timeline at 900 frames (15 seconds at 60 fps). That cap is removed:
the timeline now covers the entire finite source duration at the chosen FPS.
Still **frames** accepts longer lengths too; type a number beyond the slider's
initial range. Changing FPS does not shorten a video.
The classic-cycle loop shortcut also uses its exact period rather than the old
900-frame cutoff. If the common period exceeds JavaScript's safe integer range,
the shortcut is disabled and suggests a fixed-grid scatter loop instead.

## Export controls

- Leave **export selected interval** off for the entire clip. Enable it to enter
  start/end seconds. End is exclusive; times are quantized to actual frames.
- Intervals retain the full timeline's grid, appearance and scatter clocks.
  Trimming never creates a new scatter loop or restarts a reveal. A deliberately
  trimmed loop need not close seamlessly.
- **save directly to disk** is available where the browser exposes local file
  pickers (typically desktop Chromium on HTTPS). This requires only the chosen
  local file/folder permission; no media is uploaded or sent to a server.

For MP4, choose a destination file to save one continuous movie. Encoded bytes
stream to disk, with the standard MP4 index written at the end. The file becomes
usable when export finishes; this is not an HTTP fast-start movie. Native save
dialogs handle replacement approval for an existing chosen file.

For PNG, choose an empty folder. Export creates `…-part0001.zip`,
`…-part0002.zip`, etc., each with a README. An existing part name stops export
instead of overwriting it. Unzip all parts into the same directory and import
the images as a sequence at the export FPS. Filenames retain absolute source
indices with sufficient zero-padding. Multiple alpha/printing passes keep their
separate subfolders; a part boundary may fall inside a pass.

Without disk access, or with the checkbox off, the browser downloads numbered
parts. Allow multiple downloads when prompted. PNG archives are split after
2,000 images or about 128 MiB of PNG payload; MP4 download parts use about
64 MiB of encoded media or a conservative resolution-based frame budget, at
most 10,000 frames per part. MP4 parts each play independently, in numbered
order, and can be placed back-to-back in an editor without omitted frames.
These budgets split output rather than truncating the timeline. A very large
individual frame can exceed a budget; codec/muxer overhead is additional.

Cancel keeps completed parts. An incomplete disk write is aborted and its
temporary contents are discarded; the browser may leave an empty newly-created
directory entry. A pre-existing MP4 remains untouched until a successful close.

## Remaining practical limits

Long videos still take time to seek, render and encode. Memory depends on source
decoding, output resolution, the current glyph library and codec buffers, not
only the export length. Direct MP4 writing avoids retaining the complete movie,
but its sample index grows with frame count. Download fallback holds one bounded
part plus short-lived download URLs. PNG holds a frame/current part, not a full
sequence. Disk space and browser codec/resolution support still apply.

MP4 remains H.264, opaque and silent as before; transparent passes are PNG-only.
SVG exports the current visible frame using the same original vector outlines,
not a sequence or retraced raster. Halftone separations, projects, shuffle,
infinite hold, scatter and blend keep their previous semantics. Export interval
and disk destination preferences are transient UI controls, not artwork settings.

Tests cover long frame counts, absolute trims and sampling, encoder timestamps,
part boundaries, archive contents, cancellation, disk failures and collision
protection. No new packages are required.
