import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { rejectsScan, scanBlurLimit } from "../src/engine/scanQuality";
import { historicalPresets, presetGlyph, rejectedScanIds } from "../src/presets";
import { presetMetrics } from "../src/generatedPresetMetrics";
import { cumulativeWeights, weightedCycleIndex } from "../src/engine/cellParams";

describe("conservative scan screening", () => {
  it("rejects tiny, non-finite and unusually blurred scans but keeps normal antialiasing", () => {
    expect(rejectsScan({ edge: 15, blur: 1 }, 3.5)).toBe(true);
    expect(rejectsScan({ edge: 80, blur: Infinity }, 3.5)).toBe(true);
    expect(rejectsScan({ edge: 80, blur: 4 }, 3.5)).toBe(true);
    expect(rejectsScan({ edge: 16, blur: 1.5 }, 3.5)).toBe(false);
    expect(scanBlurLimit([])).toBe(3.5);
  });

  it("compares blur within a source instead of dropping an entire soft historical page", () => {
    const source = Array.from({ length: 100 }, (_, index) => ({ edge: 60, blur: 4 + index / 100 }));
    source.push({ edge: 60, blur: 12 });
    const limit = scanBlurLimit(source);
    expect(limit).toBeGreaterThan(4);
    expect(source.filter((mark) => rejectsScan(mark, limit)).length).toBeLessThanOrEqual(3);
  });

  it("screens a small minority, preserving the original assets and identities", () => {
    expect(rejectedScanIds.size).toBeGreaterThan(0);
    expect(rejectedScanIds.size / Object.keys(presetMetrics).length).toBeLessThan(0.02);
    for (const id of rejectedScanIds) expect(presetGlyph(id)?.id).toBe(id);
  });

  it.each(historicalPresets)("$label keeps at least forty selectable marks on each level", (preset) => {
    for (const weights of preset.weights) expect(weights.filter((weight) => weight > 0).length).toBeGreaterThanOrEqual(40);
  });

  it.each(historicalPresets)("$label never automatically selects an excluded impression", (preset) => {
    preset.levels.forEach((pool, index) => {
      const totals = cumulativeWeights(preset.weights[index]);
      for (let cell = 0; cell < 1000; cell += 1) {
        const id = pool[weightedCycleIndex(971, cell, totals, cell % 5, 2)];
        expect(rejectedScanIds.has(id)).toBe(false);
      }
    });
  });

  it("matches a fresh audit of every measured catalogue entry", () => {
    expect(() => execFileSync(process.execPath, ["../../scripts/audit-glyph-quality.mjs", "--check"],
      { stdio: "pipe" })).not.toThrow();
  });
});
