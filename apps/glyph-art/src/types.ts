/**
 * glyph art model.
 *
 * A raster is resampled onto a square grid, the grid is quantized into tone
 * bands, and each cell prints a mark. **Tone is carried by the size of the
 * mark, never by its colour.** Everything below serves that one idea.
 *
 * The consequence that shapes the whole schema: a band stores a *coverage*
 * target, not a size. Size is solved from coverage and the mark's own measured
 * ink density, because a thin comma and a solid square at the same nominal
 * size are wildly different tones to the eye. See `engine/ramp.ts`.
 */

export type Range = { min: number; max: number };

/**
 *  mono   — one ink colour on one paper colour.
 *  source — each mark is filled with the average colour of its own cell, so
 *           the artwork keeps the source's colour while tone still comes from
 *           mark size.
 */
export type ColorMode = "mono" | "source";

/** Where a mark's artwork comes from. */
export type GlyphKind = "mark" | "text" | "file";

export const markKinds: GlyphKind[] = ["mark", "text", "file"];

export type GlyphSpec = {
  id: string;
  label: string;
  kind: GlyphKind;
  /**
   *  mark — inline SVG markup from the shipped set.
   *  text — the character(s) to typeset.
   *  file — a data URL for an uploaded PNG, JPEG or SVG.
   */
  source: string;
  /** Font stack for a `text` glyph. Ignored otherwise. */
  font?: string;
};

export type Band = {
  /** Marks drawn from, in cycle order. Empty prints nothing — the band is paper. */
  glyphs: string[];
  /**
   * Size as a fraction of the cell, or null to solve it from the tone curve.
   * A number here means the user dragged this band off the curve by hand.
   */
  size: number | null;
};

export type Settings = {
  seed: number;
  /**
   * Cells across the width. The output's aspect follows the source, so there
   * is no fit setting to get wrong: the grid height is derived, and the source
   * is centre-cropped by the sub-cell remainder rather than stretched.
   */
  grid: number;
  /** Lightest band first. Length is the band count, 2..24. */
  bands: Band[];
  /** Exponent of the tone curve. Higher prints lighter, lower prints heavier. */
  weight: number;
  /** Black point and white point applied to the cell tones before banding. */
  levels: Range;
  /** One knob for seeded rotation, offset and size jitter per cell, 0..1. */
  hand: number;
  colorMode: ColorMode;
  /** Swap ink and paper. */
  invert: boolean;
  /**
   * Reverse which band a tone lands on, so the heavy marks print on the
   * brightest cells instead of the darkest. This is not a colour change —
   * the marks themselves stay where they are on the ramp.
   */
  rampInvert: boolean;
  /** Time posterization for video, 4..16 frames per second. */
  targetFps: number;
  /** Sequence length for a still source. */
  stillFrames: number;
  /** Frames each mark of a cycling band is held for, 1..24. */
  hold: number;
  /** Marks available to the bands, including anything the user added. */
  glyphs: GlyphSpec[];
};

/**
 * How a finished frame is written out.
 *  flat  — opaque, paper behind the marks
 *  ink   — the marks only, paper keyed to transparency
 *  paper — the paper only, the marks punched out of it
 */
export type ExportInk = "flat" | "ink" | "paper";

export type ExportFormat = "png" | "mp4";

export type MediaKind = "video" | "image";

export const minGrid = 8;
export const maxGrid = 240;
export const minBands = 2;
export const maxBands = 24;
export const minWeight = 0.6;
export const maxWeight = 2.4;
export const minHold = 1;
export const maxHold = 24;
export const minFps = 4;
export const maxFps = 16;

/** Guards against a long sequence exhausting memory mid-export. */
export const maxExportFrames = 900;

/**
 * A mark smaller than this is grit rather than a mark, and one larger than
 * this stops reading as a grid. The upper bound is deliberately over 1: the
 * darkest band has to overflow its cell or the shadows break into polka dots
 * instead of knitting into mass.
 */
export const minMarkSize = 0.05;
export const maxMarkSize = 1.6;

/** Ink coverage asked of the darkest band. Over 1 so its seams close. */
export const coveragePeak = 1.05;

export const fontStacks: { id: string; label: string; stack: string }[] = [
  { id: "mono", label: "mono", stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  { id: "sans", label: "sans", stack: "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif" },
  { id: "serif", label: "serif", stack: "Georgia, 'Times New Roman', Times, serif" },
];

/**
 * Output pixels per cell. Deriving the raster from the grid rather than from
 * the source is what lets the preview canvas *be* the export frame: there is
 * no proxy, so there is no class of bugs where the two disagree.
 *
 * Always even, and always a whole number of pixels. Whole cells keep seams and
 * moiré out of the grid; even cells keep both output dimensions even, which is
 * what H.264 requires — so MP4 never has to resize the frame behind the user's
 * back and break the preview's promise.
 */
export function cellPixels(grid: number) {
  const fitted = Math.floor(2880 / Math.max(1, grid));
  return Math.max(4, Math.min(24, fitted - (fitted % 2)));
}

export function emptyBand(): Band {
  return { glyphs: [], size: null };
}

export const defaultBandCount = 7;

/**
 * Seven bands: three is a poster, twelve is a halftone, seven is a ladder
 * where every rung is distinguishable at a glance. The grid of 72 is the point
 * where a face survives and the marks are still unmistakably marks.
 *
 * `bands` and `glyphs` are filled in by the store from the shipped mark set,
 * because the band assignment depends on the band count.
 */
export const defaultSettings: Settings = {
  seed: 8471,
  grid: 72,
  bands: [],
  weight: 1.45,
  levels: { min: 0, max: 1 },
  hand: 0,
  colorMode: "mono",
  invert: false,
  rampInvert: false,
  targetFps: 12,
  stillFrames: 1,
  hold: 2,
  glyphs: [],
};
