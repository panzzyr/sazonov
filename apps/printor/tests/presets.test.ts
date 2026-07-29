import { describe, expect, it } from "vitest";
import { presets } from "../src/presets";

describe("built-in presets", () => {
  it("have unique names", () => {
    expect(new Set(presets.map((preset) => preset.name)).size).toBe(presets.length);
  });

  it("keep bounded settings inside supported ranges", () => {
    for (const preset of presets) {
      if (preset.settings.targetFps !== undefined) {
        expect(preset.settings.targetFps).toBeGreaterThanOrEqual(1);
        expect(preset.settings.targetFps).toBeLessThanOrEqual(30);
      }
      if (preset.settings.chaos !== undefined) {
        expect(preset.settings.chaos).toBeGreaterThanOrEqual(0);
        expect(preset.settings.chaos).toBeLessThanOrEqual(1);
      }
      if (preset.settings.levels !== undefined) {
        expect(preset.settings.levels).toBeGreaterThanOrEqual(2);
        expect(preset.settings.levels).toBeLessThanOrEqual(16);
      }
    }
  });
});
