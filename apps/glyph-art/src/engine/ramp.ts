/**
 * The tone ramp: coverage in, mark size out.
 *
 * The load-bearing decision of the whole tool lives here. Mapping tone
 * straight to size looks obvious and is wrong — ink coverage grows as the
 * square of size, so a cell at half tone receives a quarter of the ink it
 * should, midtones wash out and shadows slam shut. Every bad ASCII-art
 * generator is bad for this reason.
 *
 * So tone is mapped to *coverage*, the fraction of the cell the mark should
 * ink, and size is solved backwards from the mark's own measured density.
 *
 *   coverage c  = the authored quantity, from the tone curve
 *   density  ρ  = ink fraction of the mark's tight bounding box, measured
 *   aspect   a  = that box's width over its height
 *   size     s  = sqrt( c / (ρ · min(a, 1/a)) ), the long side in cell units
 *
 * Nothing here touches the DOM, so the ramp is unit-testable without a canvas.
 */

import {
  coveragePeak,
  maxMarkSize,
  minMarkSize,
  type Band,
  type Settings,
} from "../types";

/** The tone a band represents: its centre, 0 at the lightest, 1 at the darkest. */
export function bandCenter(index: number, bandCount: number) {
  return (index + 0.5) / Math.max(1, bandCount);
}

/**
 * Ink coverage asked of a band.
 *
 * Deliberately not photometric. The physically correct answer, `1 - luminance`,
 * reaches nearly half coverage by the second band of seven and clogs the
 * picture solid. At these cell sizes the eye reads the mark's size directly
 * rather than integrating the cell into a tone, so the curve is authored.
 */
export function coverageFor(tone: number, weight: number) {
  return coveragePeak * Math.pow(Math.max(0, Math.min(1, tone)), weight);
}

/** Long-side size in cell units, before clamping. */
export function rawSize(coverage: number, density: number, aspect: number) {
  const box = Math.min(aspect, 1 / aspect);
  const effective = Math.max(1e-4, density * box);
  return Math.sqrt(coverage / effective);
}

export function clampSize(size: number) {
  return Math.max(minMarkSize, Math.min(maxMarkSize, size));
}

export type SolvedBand = {
  index: number;
  tone: number;
  coverage: number;
  size: number;
  /** True when the mark is too sparse to reach the band's tone. */
  clamped: boolean;
  /** True when the user dragged this band off the curve. */
  manual: boolean;
};

export type DensityLookup = (glyphId: string) => { density: number; aspect: number } | undefined;

/**
 * Solves every band. A band with no marks still reports a tone so the ramp
 * editor can label it, but it prints nothing.
 */
export function solveRamp(settings: Settings, lookup: DensityLookup): SolvedBand[] {
  return settings.bands.map((band, index) => {
    const tone = bandCenter(index, settings.bands.length);
    const coverage = coverageFor(tone, settings.weight);
    const reference = band.glyphs.length ? lookup(band.glyphs[0]) : undefined;

    if (band.size !== null) {
      return { index, tone, coverage, size: clampSize(band.size), clamped: false, manual: true };
    }
    if (!reference) {
      return { index, tone, coverage, size: 0, clamped: false, manual: false };
    }

    const raw = rawSize(coverage, reference.density, reference.aspect);
    return {
      index,
      tone,
      coverage,
      size: clampSize(raw),
      clamped: raw > maxMarkSize,
      manual: false,
    };
  });
}

/**
 * Every mark in a cycling band has to print the *same* coverage, or the tone
 * visibly pulses as the band cycles and it reads as a bug. The band owns the
 * size; each mark corrects for its own density against the band's first mark.
 */
export function poolCorrection(referenceDensity: number, glyphDensity: number) {
  if (glyphDensity <= 0) return 1;
  return Math.sqrt(referenceDensity / glyphDensity);
}

/** Re-solves every band from the current curve, discarding hand-set sizes. */
export function rebalance(bands: Band[]): Band[] {
  return bands.map((band) => ({ ...band, size: null }));
}
