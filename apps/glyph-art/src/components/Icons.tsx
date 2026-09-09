/**
 * The panel icons.
 *
 * One flat record of 16-unit line drawings, not a dependency and not a font:
 * the tool ships no remote assets, and a dozen glyphs of markup weigh less
 * than the code to load an icon set would.
 *
 * They are navigation, not decoration — every one sits beside a heading or a
 * label that already says the same thing in words, so they are hidden from
 * assistive technology and drawn in `currentColor` to follow the theme and the
 * pressed state of whatever holds them.
 */

import type { ReactNode } from "react";

export type IconName =
  | "mode"
  | "source"
  | "presets"
  | "grid"
  | "tone"
  | "screen"
  | "separation"
  | "marks"
  | "output"
  | "timing"
  | "export"
  | "project"
  | "ramp"
  | "raster"
  | "video"
  | "vector";

const solid = { fill: "currentColor", stroke: "none" } as const;

const drawings: Record<IconName, ReactNode> = {
  // A switch: two settings, one of them thrown.
  mode: (
    <>
      <rect x="1.75" y="4.25" width="12.5" height="7.5" rx="3.75" />
      <circle cx="5.5" cy="8" r="1.6" {...solid} />
    </>
  ),
  // The picture the tool reads.
  source: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="5.6" cy="6.4" r="1.1" />
      <path d="M2.4 11.6 6 8l2.6 2.6 2.4-2.2 2.6 2.4" />
    </>
  ),
  // A stack of ready-made sets.
  presets: (
    <>
      <path d="M8 1.9 14 5 8 8.1 2 5Z" />
      <path d="M2.4 8.2 8 11l5.6-2.8" />
      <path d="M2.4 11.2 8 14l5.6-2.8" />
    </>
  ),
  // The cells the source is averaged into.
  grid: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M6.17 2.5v11M9.83 2.5v11M2.5 6.17h11M2.5 9.83h11" />
    </>
  ),
  // Light and dark, and where the tool cuts between them.
  tone: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 2.25a5.75 5.75 0 0 1 0 11.5Z" {...solid} />
    </>
  ),
  // A screen: the same dot, printing more or less of the paper.
  screen: (
    <>
      <circle cx="4" cy="4" r="1.9" {...solid} />
      <circle cx="8" cy="4" r="1.4" {...solid} />
      <circle cx="12" cy="4" r="0.9" {...solid} />
      <circle cx="4" cy="8" r="1.4" {...solid} />
      <circle cx="8" cy="8" r="0.9" {...solid} />
      <circle cx="12" cy="8" r="0.55" {...solid} />
      <circle cx="4" cy="12" r="0.9" {...solid} />
      <circle cx="8" cy="12" r="0.55" {...solid} />
      <circle cx="12" cy="12" r="0.35" {...solid} />
    </>
  ),
  // Plates overlapping, which is what a separation is for.
  separation: (
    <>
      <circle cx="6.2" cy="6.4" r="3.5" />
      <circle cx="9.8" cy="6.4" r="3.5" />
      <circle cx="8" cy="9.6" r="3.5" />
    </>
  ),
  // A mark, drawn as the one every set has.
  marks: (
    <>
      <path d="M3.6 13.2 8 2.8l4.4 10.4" />
      <path d="M5.5 9.4h5" />
    </>
  ),
  // The frame, with the corner marks a page is trimmed to.
  output: (
    <>
      <path d="M2 5.5v-3h3M11 2.5h3v3M14 10.5v3h-3M5 13.5H2v-3" />
      <rect x="5.5" y="5.5" width="5" height="5" />
    </>
  ),
  // How long the sequence runs.
  timing: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.4V8l2.6 1.6" />
    </>
  ),
  // Out of the tool and onto the disk.
  export: (
    <>
      <path d="M8 2.2v7.6" />
      <path d="M4.9 6.7 8 9.8l3.1-3.1" />
      <path d="M2.5 12.6h11" />
    </>
  ),
  // A file, saved and reopened.
  project: (
    <>
      <path d="M3.5 1.9h5.6l3.4 3.4v8.8h-9Z" />
      <path d="M9.1 1.9v3.4h3.4" />
    </>
  ),
  // Bands, lightest to darkest.
  ramp: (
    <>
      <path d="M2.5 13.5h11" />
      <path d="M4 13.5v-2.6M8 13.5V7.4M12 13.5V3.9" />
    </>
  ),
  // Pixels.
  raster: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" />
      <path d="M2.5 2.5h5.5V8h5.5V2.5" fill="none" />
      <path d="M2.5 8h5.5v5.5H2.5Z" {...solid} />
      <path d="M8 2.5h5.5V8H8Z" {...solid} />
    </>
  ),
  // A clip.
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="1" />
      <path d="M6.6 6.2 10.6 8l-4 1.8Z" {...solid} />
    </>
  ),
  // A curve with its handles: the thing an editor can still pick up.
  vector: (
    <>
      <path d="M3 12.5c1.8-6.6 8.2-6.6 10 0" />
      <rect x="1.4" y="10.9" width="3.2" height="3.2" {...solid} />
      <rect x="11.4" y="10.9" width="3.2" height="3.2" {...solid} />
    </>
  ),
};

/** A 16px line drawing that follows the colour and the size of its label. */
export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {drawings[name]}
    </svg>
  );
}
