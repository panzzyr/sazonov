import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { churchSlavonicPreset as preset } from "../src/churchSlavonic";
import { churchSlavonicMarks, churchSlavonicSheets } from "../src/generatedChurchSlavonic";
import { activePreset, applyPreset, defaultGradientSteps, librarySpecs, presetGlyph, presetGlyphIds, presetEraList } from "../src/presets";
import { cellCoverage, poolCorrection, solveRamp } from "../src/engine/ramp";
import { encodeSettings, decodeSettings, parseSettings } from "../src/projectState";
import { initialSettings } from "../src/store";

const publicRoot = fileURLToPath(new URL("../public", import.meta.url));
const metrics = new Map(preset.glyphs.map((glyph, index) => [glyph.id, churchSlavonicMarks[index]]));

describe("the owner's exclusive Church Slavonic collection", () => {
  it("contains all and only the 104 supplied inputs, with distinct stable ids", () => {
    expect(churchSlavonicMarks.map((mark) => mark.name)).toEqual([
      ...Array.from({ length: 85 }, (_, index) => `a${String(index + 1).padStart(4, "0")}.png`),
      ...Array.from({ length: 19 }, (_, index) => `Layer ${index + 3}.png`),
    ]);
    expect(preset.glyphs).toHaveLength(104);
    expect(new Set(preset.glyphs.map((glyph) => glyph.id)).size).toBe(104);
    expect(preset.foreign).toEqual([]);
    for (const glyph of preset.glyphs) {
      expect(presetGlyphIds.has(glyph.id)).toBe(true);
      expect(presetGlyph(glyph.id)).toEqual(glyph);
      expect(glyph.source).toMatch(/^presets\/church-slavonic-vedomosti\//);
      expect(glyph.vector).toBeUndefined(); // PNG sources, not pretend-native vectors.
    }
    expect(presetEraList.some((group) => group.presets.includes(preset))).toBe(true);
    expect(defaultGradientSteps()).not.toContain(preset.id);
  });

  it("preserves every input alpha at original resolution on its lossless sheet", async () => {
    const sheets = await Promise.all(churchSlavonicSheets.map(async ([name, width, height]) => {
      const sheet = await sharp(path.join(publicRoot, name)).raw().toBuffer({ resolveWithObject: true });
      expect([sheet.info.width, sheet.info.height]).toEqual([width, height]);
      return sheet;
    }));
    for (const mark of churchSlavonicMarks) {
      const { data, info } = sheets[mark.sheet];
      const [left, top, width, height] = mark.rect;
      expect(left + width).toBeLessThanOrEqual(info.width);
      expect(top + height).toBeLessThanOrEqual(info.height);
      const ink = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) ink[y * width + x] = data[((top + y) * info.width + left + x) * info.channels];
      }
      expect(createHash("sha256").update(ink).digest("hex"), mark.name).toBe(mark.inkHash);
      expect(mark.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(churchSlavonicMarks.find((mark) => mark.name === "a0009.png")!.rect.slice(2)).toEqual([755, 647]);
  });

  it("gives every symbol a place, with varied tone pools that do not exceed the size ceiling", () => {
    expect(preset.levels).toHaveLength(12);
    expect(new Set(preset.levels.flat())).toEqual(new Set(preset.glyphs.map((glyph) => glyph.id)));
    const settings = initialSettings();
    applyPreset(settings, preset);
    const ramp = solveRamp(settings, (id) => metrics.get(id));
    for (const [level, ids] of preset.levels.entries()) {
      expect(ids.length).toBeGreaterThanOrEqual(40);
      expect(preset.weights[level]).toEqual(ids.map(() => 1));
      const reference = metrics.get(ids[0])!;
      for (const id of ids) {
        const mark = metrics.get(id)!;
        const size = ramp[level].size * poolCorrection(reference, mark);
        expect(size).toBeLessThanOrEqual(preset.maxSize + 1e-9);
        expect(size).toBeGreaterThanOrEqual(0.05);
        expect(cellCoverage(mark.density, mark.aspect) * size ** 2).toBeCloseTo(ramp[level].coverage, 8);
      }
    }
  });

  it("round-trips standalone and gradient choices without leaking other presets", () => {
    const settings = initialSettings();
    applyPreset(settings, preset);
    expect(activePreset(decodeSettings(encodeSettings(settings)))?.id).toBe(preset.id);
    expect(parseSettings({ settings }).bands).toEqual(settings.bands);
    const own = new Set(settings.glyphs.map((glyph) => glyph.id));
    const shipped = librarySpecs(settings).filter((glyph) => !own.has(glyph.id));
    expect(shipped).toHaveLength(104);
    expect(new Set(shipped.map((glyph) => glyph.id))).toEqual(new Set(preset.glyphs.map((glyph) => glyph.id)));
    settings.gradient = { ...settings.gradient, enabled: true, steps: [preset.id, "digital-reactions"] };
    expect(decodeSettings(encodeSettings(settings)).gradient).toEqual(settings.gradient);
    for (const glyph of librarySpecs(settings)) {
      expect(own.has(glyph.id) || metrics.has(glyph.id) || glyph.id.startsWith("reaction-")).toBe(true);
    }
  });
});
