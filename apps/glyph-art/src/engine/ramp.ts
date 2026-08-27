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

import { minMarkSize, type Band, type Settings } from "../types";

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
 *
 * `peak` is what the darkest band asks for. It belongs to the set of marks
 * rather than to taste: a set of airy letterpress cannot cover as much of a
 * cell as a solid woodblock without overflowing it, so each shipped preset
 * carries its own and `fitPeak` solves it for anything else.
 */
export function coverageFor(tone: number, weight: number, peak: number) {
  return peak * Math.pow(Math.max(0, Math.min(1, tone)), weight);
}

/**
 * Ink a mark covers of its cell when its long side exactly fills the cell.
 *
 * The whole size solve is this quantity read backwards, and the reason the
 * aspect belongs in it is that a mark is fitted by its long side: a mark twice
 * as wide as it is tall only reaches half the cell vertically, so it inks half
 * as much of the cell as its own density suggests.
 */
export function cellCoverage(density: number, aspect: number) {
  return Math.max(1e-4, density * Math.min(aspect, 1 / aspect));
}

/** Long-side size in cell units, before clamping. */
export function rawSize(coverage: number, density: number, aspect: number) {
  return Math.sqrt(coverage / cellCoverage(density, aspect));
}

export function clampSize(size: number, ceiling: number) {
  return Math.max(minMarkSize, Math.min(ceiling, size));
}

/**
 * A band that lands within this of the ceiling is not short of ink, it is
 * exactly on it — which is where `fitPeak` puts the darkest band by
 * construction, to the last bit of floating point. Without the tolerance
 * `fit ramp` would flag its own result as a mark that cannot reach its tone.
 */
const clampEpsilon = 1e-6;

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
  const ceiling = settings.maxSize;
  return settings.bands.map((band, index) => {
    const tone = bandCenter(index, settings.bands.length);
    const coverage = coverageFor(tone, settings.weight, settings.peak);
    const reference = band.glyphs.length ? lookup(band.glyphs[0]) : undefined;

    if (band.size !== null) {
      const size = clampSize(band.size, ceiling);
      return { index, tone, coverage, size, clamped: false, manual: true };
    }
    if (!reference) {
      return { index, tone, coverage, size: 0, clamped: false, manual: false };
    }

    const raw = rawSize(coverage, reference.density, reference.aspect);
    return {
      index,
      tone,
      coverage,
      size: clampSize(raw, ceiling),
      clamped: raw > ceiling + clampEpsilon,
      manual: false,
    };
  });
}

/**
 * The heaviest ramp this set of marks can print without any of them
 * overflowing its cell.
 *
 * This is what "fit ramp" does, and it is the only honest way to put an
 * arbitrary set of marks on a full ramp: the ramp climbs until the first mark
 * that would spill past the ceiling stops it, and the rest of the curve
 * follows. A set of hairlines lands on a lighter ramp than a set of blocks,
 * which is the truth about those marks rather than a failure to reach black.
 *
 * Every band and every mark is considered, not only the darkest band's
 * reference. Fitting on the darkest band alone looks right and is wrong: the
 * bands below it hold different marks at different tones, and a sparse one in
 * the middle hits the ceiling long before the bottom does. The result is a
 * ramp whose middle flattens into a row of identical clamped sizes — the exact
 * failure the button exists to prevent. Pool members count too, because each
 * one is sized to match its band's ink and a sparse member is sized up to do it.
 */
export function fitPeak(settings: Settings, lookup: DensityLookup) {
  let peak = Infinity;

  settings.bands.forEach((band, index) => {
    const tone = bandCenter(index, settings.bands.length) ** settings.weight;
    if (tone <= 0) return;
    for (const id of band.glyphs) {
      const mark = lookup(id);
      if (!mark || mark.density <= 0) continue;
      const reach = cellCoverage(mark.density, mark.aspect) * settings.maxSize ** 2;
      peak = Math.min(peak, reach / tone);
    }
  });

  return Number.isFinite(peak) ? peak : settings.peak;
}

/**
 * Every mark in a cycling band has to print the *same* coverage, or the tone
 * visibly pulses as the band cycles and it reads as a bug. The band owns the
 * size; each mark corrects for its own coverage against the band's first mark.
 *
 * The correction is on cell coverage rather than on density alone, because
 * that is what the size solve inverts. Correcting on density would leave a
 * mark of a different proportion printing the wrong tone — sparse pools of
 * mixed proportions are exactly what the presets are made of, so the
 * difference is not academic.
 */
export function poolCorrection(
  reference: { density: number; aspect: number },
  glyph: { density: number; aspect: number },
) {
  if (glyph.density <= 0) return 1;
  return Math.sqrt(
    cellCoverage(reference.density, reference.aspect)
    / cellCoverage(glyph.density, glyph.aspect),
  );
}

/** Re-solves every band from the current curve, discarding hand-set sizes. */
export function rebalance(bands: Band[]): Band[] {
  return bands.map((band) => ({ ...band, size: null }));
}
