/**
 * The shipped mark set, `press`.
 *
 * Seven marks so a first drop already prints something finished. Their ink
 * densities fall gently from about 0.79 down to 0.50, which matters: if the
 * darkest mark were solid the size ramp would stall exactly where it should be
 * accelerating, and large shadows would flatten into a dead black field. A
 * diamond at 137% of its cell tiles into a black lattice instead, and keeps a
 * trace of structure in the shadows.
 *
 * Densities are not hard-coded anywhere. Every mark is measured on load by the
 * same code that measures an uploaded file, so the ramp solver cannot drift
 * away from what is actually drawn.
 */

import type { GlyphSpec } from "../types";

export type MarkDefinition = {
  id: string;
  label: string;
  /** Path data inside a `0 0 100 100` viewBox. */
  body: string;
};

export const markDefinitions: MarkDefinition[] = [
  {
    id: "mark-point",
    label: "point",
    body: '<circle cx="50" cy="50" r="50"/>',
  },
  {
    id: "mark-cross",
    label: "cross",
    body: '<path d="M29.16 0H70.84V29.16H100V70.84H70.84V100H29.16V70.84H0V29.16H29.16Z"/>',
  },
  {
    id: "mark-saltire",
    label: "saltire",
    body:
      '<path d="M0 0H19.18L100 80.82V100H80.82L0 19.18Z"/>'
      + '<path d="M80.82 0H100V19.18L19.18 100H0V80.82Z"/>',
  },
  {
    id: "mark-frame",
    label: "frame",
    body: '<path fill-rule="evenodd" d="M0 0H100V100H0Z M18.38 18.38V81.62H81.62V18.38Z"/>',
  },
  {
    // A ring rather than the obvious set of bars. Bars at this band's size
    // overflow past the cell horizontally and fuse with their neighbours into
    // unbroken scanlines, which reads as a display artefact instead of as a
    // printed mark. Rings overlap into chain mail and stay countable.
    id: "mark-ring",
    label: "ring",
    body: '<path fill-rule="evenodd" d="M0 50a50 50 0 1 0 100 0a50 50 0 1 0-100 0Z'
      + ' M24.5 50a25.5 25.5 0 1 0 51 0a25.5 25.5 0 1 0-51 0Z"/>',
  },
  {
    id: "mark-blot",
    label: "blot",
    body: '<path d="M50 0L100 50L50 100L0 50Z"/>',
  },
];

export function markSvg(body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">`
    + `<g fill="#000">${body}</g></svg>`;
}

export function markSpecs(): GlyphSpec[] {
  return markDefinitions.map((mark) => ({
    id: mark.id,
    label: mark.label,
    kind: "mark" as const,
    source: markSvg(mark.body),
  }));
}

/**
 * Assigns the shipped marks across an arbitrary band count.
 *
 * The lightest band is left empty on purpose. Paper is a value, and reserving
 * the top of the ramp for it is the single decision that makes a first drop
 * read as a print rather than as wallpaper.
 */
export function defaultBandGlyphs(bandCount: number): string[][] {
  const bands: string[][] = [[]];
  const marked = Math.max(1, bandCount - 1);
  for (let index = 0; index < marked; index += 1) {
    const position = marked === 1 ? markDefinitions.length - 1
      : Math.round((index * (markDefinitions.length - 1)) / (marked - 1));
    bands.push([markDefinitions[position].id]);
  }
  return bands.slice(0, bandCount);
}
