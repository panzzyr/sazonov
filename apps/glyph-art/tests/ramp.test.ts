import { describe, expect, it } from "vitest";
import {
  bandCenter,
  clampSize,
  coverageFor,
  poolCorrection,
  rawSize,
  rebalance,
  solveRamp,
} from "../src/engine/ramp";
import { defaultBandGlyphs, markDefinitions } from "../src/engine/marks";
import { initialSettings } from "../src/store";
import { maxMarkSize, type Settings } from "../src/types";

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
          const coverage = coverageFor(bandCenter(index, bands), weight);
          expect(coverage).toBeGreaterThan(previous);
          previous = coverage;
        }
      }
    }
  });

  it("never asks for coverage outside the authored peak", () => {
    expect(coverageFor(0, 1.45)).toBe(0);
    expect(coverageFor(1, 1.45)).toBeCloseTo(1.05);
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

  it("keeps the shipped set climbing across every band", () => {
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
    expect(clampSize(9)).toBe(maxMarkSize);
    expect(clampSize(0)).toBeGreaterThan(0);
  });
});

describe("cycling within a band", () => {
  it("prints the same coverage whatever the pool member's density", () => {
    const bandSize = rawSize(0.5, 0.6, 1);
    const corrected = bandSize * poolCorrection(0.6, 0.3);
    // Half the density needs the same ink, so it prints at the same coverage.
    expect(0.3 * corrected * corrected).toBeCloseTo(0.6 * bandSize * bandSize, 6);
  });

  it("leaves the reference mark untouched", () => {
    expect(poolCorrection(0.6, 0.6)).toBe(1);
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
