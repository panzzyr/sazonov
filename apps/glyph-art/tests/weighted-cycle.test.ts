import { describe, expect, it } from "vitest";
import { cumulativeWeights, weightedCycleIndex } from "../src/engine/cellParams";

describe("weighted cycling", () => {
  it("is deterministic for a seed, a cell and a frame", () => {
    const totals = cumulativeWeights([1, 2, 3, 4]);
    for (let cell = 0; cell < 50; cell += 1) {
      expect(weightedCycleIndex(9, cell, totals, 3, 2)).toBe(weightedCycleIndex(9, cell, totals, 3, 2));
    }
  });

  it("picks a mark in proportion to its weight", () => {
    // A letterform of three impressions weighs 1/3 each: together as likely
    // as a letterform of one.
    const totals = cumulativeWeights([1 / 3, 1 / 3, 1 / 3, 1]);
    let single = 0;
    const cells = 8000;
    for (let cell = 0; cell < cells; cell += 1) {
      if (weightedCycleIndex(7, cell, totals, 0, 1) === 3) single += 1;
    }
    expect(single / cells).toBeCloseTo(0.5, 1);
  });

  it("never picks a mark that weighs nothing", () => {
    const totals = cumulativeWeights([1, 0, 1]);
    for (let cell = 0; cell < 2000; cell += 1) {
      expect(weightedCycleIndex(3, cell, totals, 0, 1)).not.toBe(1);
    }
  });

  it("moves a cycling cell to another mark from one step to the next", () => {
    const totals = cumulativeWeights(Array.from({ length: 60 }, () => 1));
    let changed = 0;
    for (let cell = 0; cell < 300; cell += 1) {
      if (weightedCycleIndex(1, cell, totals, 0, 1) !== weightedCycleIndex(1, cell, totals, 1, 1)) changed += 1;
    }
    expect(changed).toBeGreaterThan(290);
  });
});
