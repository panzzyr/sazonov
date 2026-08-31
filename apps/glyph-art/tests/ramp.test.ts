import { describe, expect, it } from "vitest";
import {
  bandCenter,
  cellCoverage,
  clampSize,
  coverageFor,
  fitPeak,
  poolCorrection,
  rawSize,
  rebalance,
  solveRamp,
} from "../src/engine/ramp";
import { defaultBandGlyphs, markDefinitions } from "../src/engine/marks";
import { initialSettings } from "../src/store";
import { defaultSettings, maxMarkSize, type Settings } from "../src/types";

/** Stand-in for the browser's measurement, with the densities the set aims at. */
const densities: Record<string, number> = {
  "mark-point": 0.785,
  "mark-cross": 0.66,
  "mark-saltire": 0.62,
  "mark-frame": 0.6,
  "mark-ring": 0.58,
  "mark-blot": 0.5,
};

const lookup = (id: string) => {
  const density = densities[id];
  return density === undefined ? undefined : { density, aspect: 1 };
};

function sevenBands(): Settings {
  return {
    ...initialSettings(),
    bands: defaultBandGlyphs(7).map((glyphs) => ({ glyphs, size: null })),
  };
}

describe("the tone curve", () => {
  it("puts band centres between the boundaries", () => {
    expect(bandCenter(0, 7)).toBeCloseTo(0.5 / 7);
    expect(bandCenter(6, 7)).toBeCloseTo(6.5 / 7);
  });

  it("climbs monotonically for any band count and any weight", () => {
    for (const bands of [2, 3, 7, 12, 24]) {
      for (const weight of [0.6, 1, 1.45, 2.4]) {
        let previous = -1;
        for (let index = 0; index < bands; index += 1) {
          const coverage = coverageFor(bandCenter(index, bands), weight, 1.05);
          expect(coverage).toBeGreaterThan(previous);
          previous = coverage;
        }
      }
    }
  });

  it("never asks for coverage outside the peak it was given", () => {
    expect(coverageFor(0, 1.45, 1.05)).toBe(0);
    expect(coverageFor(1, 1.45, 1.05)).toBeCloseTo(1.05);
    expect(coverageFor(1, 1.45, 0.3)).toBeCloseTo(0.3);
  });
});

describe("solving size from coverage", () => {
  it("inverts the coverage a mark actually prints", () => {
    // A mark of density ρ at size s inks ρ·s² of a square cell.
    for (const density of [0.5, 0.66, 0.785]) {
      for (const coverage of [0.1, 0.4, 0.9]) {
        const size = rawSize(coverage, density, 1);
        expect(density * size * size).toBeCloseTo(coverage, 6);
      }
    }
  });

  it("fits the long side, so a tall mark and a wide one print the same tone", () => {
    const tall = rawSize(0.4, 0.6, 0.5);
    const wide = rawSize(0.4, 0.6, 2);
    expect(tall).toBeCloseTo(wide, 10);
  });

  it("gives a sparser mark a larger size for the same tone", () => {
    expect(rawSize(0.5, 0.4, 1)).toBeGreaterThan(rawSize(0.5, 0.8, 1));
  });

  it("shuts a wide mark out of the dark end, at equal density", () => {
    // Why an elongated mark sorts onto the light levels on its own, with
    // nothing in the solver looking at proportion to put it there: fitted by
    // its long side, a mark two and a half times as wide as it is tall reaches
    // only two fifths of the cell vertically, so at any given size it inks two
    // fifths of what a square mark of the same density would. It therefore
    // hits the size ceiling at a far lighter tone.
    const density = 0.4;
    const ceiling = 1.15;
    const reach = (aspect: number) => cellCoverage(density, aspect) * ceiling ** 2;

    expect(reach(2.5)).toBeCloseTo(reach(1) * 0.4, 6);
    expect(reach(2.5)).toBeLessThan(reach(1));
    expect(rawSize(0.2, density, 2.5)).toBeGreaterThan(rawSize(0.2, density, 1));
  });

  it("keeps the shipped set climbing across every band", () => {
    expect(defaultSettings.peak).toBeCloseTo(1.05);
    const solved = solveRamp(sevenBands(), lookup);
    expect(solved[0].size).toBe(0);
    let previous = 0;
    for (const band of solved.slice(1)) {
      expect(band.size).toBeGreaterThan(previous);
      previous = band.size;
    }
    // The darkest band has to overflow its cell or the shadows break up.
    expect(previous).toBeGreaterThan(1);
  });

  it("reports a mark too sparse to reach its band", () => {
    const settings = sevenBands();
    const sparse = solveRamp(settings, () => ({ density: 0.02, aspect: 1 }));
    expect(sparse.at(-1)?.clamped).toBe(true);
    expect(sparse.at(-1)?.size).toBe(maxMarkSize);
  });

  it("leaves a hand-set band alone and rebalance puts it back", () => {
    const settings = sevenBands();
    settings.bands[3].size = 0.25;
    const solved = solveRamp(settings, lookup);
    expect(solved[3].manual).toBe(true);
    expect(solved[3].size).toBeCloseTo(0.25);

    const restored = solveRamp({ ...settings, bands: rebalance(settings.bands) }, lookup);
    expect(restored[3].manual).toBe(false);
    expect(restored[3].size).not.toBeCloseTo(0.25);
  });

  it("clamps a hand-set size into the drawable range", () => {
    expect(clampSize(9, maxMarkSize)).toBe(maxMarkSize);
    expect(clampSize(0, maxMarkSize)).toBeGreaterThan(0);
  });

  it("honours a tightened ceiling instead of the absolute one", () => {
    const settings = { ...sevenBands(), maxSize: 1 };
    const solved = solveRamp(settings, lookup);
    for (const band of solved) expect(band.size).toBeLessThanOrEqual(1);
  });
});

describe("fitting the ramp to the marks", () => {
  it("lands the darkest band exactly on the ceiling", () => {
    for (const ceiling of [1, 1.15, 1.6]) {
      for (const density of [0.12, 0.4, 0.9]) {
        const settings = { ...sevenBands(), maxSize: ceiling };
        settings.peak = fitPeak(settings, () => ({ density, aspect: 1 }));
        const solved = solveRamp(settings, () => ({ density, aspect: 1 }));
        expect(solved.at(-1)!.size).toBeCloseTo(ceiling, 6);
        expect(solved.at(-1)!.clamped).toBe(false);
      }
    }
  });

  it("gives a sparse set a lighter ramp than a solid one, rather than clamping it", () => {
    const sparse = { ...sevenBands(), maxSize: 1.15 };
    sparse.peak = fitPeak(sparse, () => ({ density: 0.1, aspect: 1 }));
    const solid = { ...sevenBands(), maxSize: 1.15 };
    solid.peak = fitPeak(solid, () => ({ density: 0.9, aspect: 1 }));
    expect(sparse.peak).toBeLessThan(solid.peak);
  });

  it("leaves the peak alone when no band holds a measurable mark", () => {
    const settings = sevenBands();
    for (const band of settings.bands) band.glyphs = [];
    expect(fitPeak(settings, lookup)).toBe(settings.peak);
  });

  it("is held back by a sparse mark in the middle, not only by the darkest band", () => {
    const settings = { ...sevenBands(), maxSize: 1.15 };
    // A hairline on band 3 cannot print band 3's ink at any size that fits, so
    // the whole ramp has to come down to it — fitting on the last band alone
    // would leave band 3 clamped and the middle of the ladder flat.
    const sparse = (id: string) => (settings.bands[3].glyphs.includes(id)
      ? { density: 0.05, aspect: 1 }
      : { density: 0.7, aspect: 1 });

    settings.peak = fitPeak(settings, sparse);
    const solved = solveRamp(settings, sparse);
    for (const band of solved) {
      expect(band.size).toBeLessThanOrEqual(settings.maxSize + 1e-9);
      expect(band.clamped).toBe(false);
    }
    expect(solved[3].size).toBeCloseTo(settings.maxSize, 6);
  });

  it("keeps every mark of a cycling band inside the ceiling too", () => {
    const settings = { ...sevenBands(), maxSize: 1.15 };
    settings.bands[6].glyphs = ["mark-blot", "mark-ring"];
    const mixed = (id: string) => (id === "mark-ring"
      ? { density: 0.08, aspect: 1 }
      : { density: 0.7, aspect: 1 });

    settings.peak = fitPeak(settings, mixed);
    const solved = solveRamp(settings, mixed);
    const reference = mixed("mark-blot");
    const sparseSize = solved[6].size * poolCorrection(reference, mixed("mark-ring"));
    expect(sparseSize).toBeLessThanOrEqual(settings.maxSize + 1e-9);
  });
});

describe("cycling within a band", () => {
  it("prints the same coverage whatever the pool member's density", () => {
    const reference = { density: 0.6, aspect: 1 };
    const other = { density: 0.3, aspect: 1 };
    const bandSize = rawSize(0.5, reference.density, reference.aspect);
    const corrected = bandSize * poolCorrection(reference, other);
    // Half the density needs the same ink, so it prints at the same coverage.
    expect(other.density * corrected ** 2).toBeCloseTo(reference.density * bandSize ** 2, 6);
  });

  it("corrects for proportion too, not only for density", () => {
    // A mark twice as wide as it is tall only reaches half the cell in the
    // short direction, so it inks half of what its density suggests. A
    // correction on density alone would print this pair two tones apart.
    const reference = { density: 0.6, aspect: 1 };
    const wide = { density: 0.6, aspect: 2 };
    const bandSize = rawSize(0.4, reference.density, reference.aspect);
    const corrected = bandSize * poolCorrection(reference, wide);
    expect(cellCoverage(wide.density, wide.aspect) * corrected ** 2)
      .toBeCloseTo(cellCoverage(reference.density, reference.aspect) * bandSize ** 2, 6);
  });

  it("leaves the reference mark untouched", () => {
    const mark = { density: 0.6, aspect: 1 };
    expect(poolCorrection(mark, mark)).toBe(1);
  });
});

describe("the shipped set", () => {
  it("leaves the lightest band empty so paper stays a value", () => {
    expect(defaultBandGlyphs(7)[0]).toEqual([]);
  });

  it("spans the set for any band count", () => {
    for (const count of [2, 3, 5, 7, 12]) {
      const bands = defaultBandGlyphs(count);
      expect(bands).toHaveLength(count);
      expect(bands.at(-1)).toEqual([markDefinitions.at(-1)!.id]);
    }
  });
});
