import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { activePreset, applyPreset, presetGlyphIds, presetLevels, presets } from "../src/presets";
import { bandCenter, cellCoverage, coverageFor, poolCorrection, solveRamp } from "../src/engine/ramp";
import { initialSettings } from "../src/store";
import { parseSettings, shareableSettings } from "../src/projectState";
import { defaultSettings } from "../src/types";

const publicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));

/** The build measured every mark; this is the lookup the solver wants. */
function metricsFor(preset: (typeof presets)[number]) {
  return (id: string) => preset.metrics[id];
}

describe("what a preset ships", () => {
  it("ships four sets", () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      "eighteenth-century",
      "eighteen-twelve",
      "great-war",
      "nineteen-forty-one",
    ]);
  });

  it.each(presets)("$label has twelve levels", (preset) => {
    expect(preset.levels).toHaveLength(presetLevels);
    expect(presetLevels).toBe(12);
  });

  it.each(presets)("$label puts at least two different marks on every level", (preset) => {
    for (const level of preset.levels) {
      expect(new Set(level).size).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(presets)("$label puts at least four on each of the darkest three", (preset) => {
    for (const level of preset.levels.slice(-3)) {
      expect(new Set(level).size).toBeGreaterThanOrEqual(4);
    }
  });

  it.each(presets)("$label reuses marks across levels rather than once each", (preset) => {
    const used = preset.levels.flat();
    // Every mark on more than one level is a mark printing at two sizes, which
    // is where the variety comes from without a bigger set of scans.
    expect(used.length).toBeGreaterThan(new Set(used).size);
  });

  it.each(presets)("$label only names marks it carries", (preset) => {
    const known = new Set(preset.glyphs.map((glyph) => glyph.id));
    for (const id of preset.levels.flat()) expect(known.has(id)).toBe(true);
    for (const glyph of preset.glyphs) expect(preset.metrics[glyph.id]).toBeDefined();
  });

  it.each(presets)("$label points at files that exist, by relative path", (preset) => {
    for (const glyph of preset.glyphs) {
      expect(glyph.kind).toBe("preset");
      // Relative, so the sub-path deployment works; and nothing that could
      // send the browser off this origin.
      expect(glyph.source.startsWith(`presets/${preset.id}/`)).toBe(true);
      expect(glyph.source).not.toMatch(/^[a-z]+:|^\/\/|\.\./);
      expect(existsSync(path.join(publicRoot, glyph.source))).toBe(true);
    }
  });

  it("has no id in two sets", () => {
    const ids = presets.flatMap((preset) => preset.glyphs.map((glyph) => glyph.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(presetGlyphIds.size).toBe(ids.length);
  });
});

describe("the ramp a preset solves to", () => {
  it.each(presets)("$label climbs in ink from the lightest level to the darkest", (preset) => {
    let previous = -1;
    for (let index = 0; index < preset.levels.length; index += 1) {
      const coverage = coverageFor(
        bandCenter(index, preset.levels.length),
        defaultSettings.weight,
        preset.peak,
      );
      expect(coverage).toBeGreaterThan(previous);
      previous = coverage;
    }
  });

  it.each(presets)("$label keeps every mark inside the cell it was solved for", (preset) => {
    const settings = initialSettings();
    applyPreset(settings, preset);
    const ramp = solveRamp(settings, metricsFor(preset));

    for (const [index, level] of preset.levels.entries()) {
      const reference = preset.metrics[level[0]];
      for (const id of level) {
        // The size the renderer will actually draw: the band's size, corrected
        // for this mark's own coverage. This is the promise that a preset mark
        // never spills past the ceiling and never clips.
        const size = ramp[index].size * poolCorrection(reference, preset.metrics[id]);
        expect(size).toBeLessThanOrEqual(preset.maxSize + 1e-9);
        expect(size).toBeGreaterThan(0.1);
      }
    }
  });

  it.each(presets)("$label prints the same ink from every mark on a level", (preset) => {
    const settings = initialSettings();
    applyPreset(settings, preset);
    const ramp = solveRamp(settings, metricsFor(preset));

    for (const [index, level] of preset.levels.entries()) {
      const reference = preset.metrics[level[0]];
      const target = cellCoverage(reference.density, reference.aspect) * ramp[index].size ** 2;
      for (const id of level) {
        const mark = preset.metrics[id];
        const size = ramp[index].size * poolCorrection(reference, mark);
        expect(cellCoverage(mark.density, mark.aspect) * size ** 2).toBeCloseTo(target, 6);
      }
    }
  });

  it("gives an airier set a lower peak than a solid one", () => {
    const light = presets.find((preset) => preset.id === "eighteen-twelve")!;
    const heavy = presets.find((preset) => preset.id === "nineteen-forty-one")!;
    expect(light.peak).toBeLessThan(heavy.peak);
  });
});

describe("applying a preset", () => {
  it("changes the marks and the ramp, and nothing about the picture", () => {
    const settings = initialSettings();
    settings.grid = 120;
    settings.invert = true;
    settings.rampInvert = true;
    settings.levels = { min: 0.2, max: 0.8 };
    settings.hand = 0.4;

    applyPreset(settings, presets[0]);

    expect(settings.bands).toHaveLength(presetLevels);
    expect(settings.peak).toBe(presets[0].peak);
    expect(settings.maxSize).toBe(presets[0].maxSize);
    expect(settings.grid).toBe(120);
    expect(settings.invert).toBe(true);
    expect(settings.rampInvert).toBe(true);
    expect(settings.levels).toEqual({ min: 0.2, max: 0.8 });
    expect(settings.hand).toBe(0.4);
  });

  it("keeps the shipped marks and anything already loaded", () => {
    const settings = initialSettings();
    const before = settings.glyphs.length;
    applyPreset(settings, presets[0]);
    applyPreset(settings, presets[1]);
    expect(settings.glyphs.length).toBe(
      before + presets[0].glyphs.length + presets[1].glyphs.length,
    );
  });

  it("clears sizes dragged for the marks that were there before", () => {
    const settings = initialSettings();
    settings.bands[3].size = 0.4;
    applyPreset(settings, presets[0]);
    expect(settings.bands.every((band) => band.size === null)).toBe(true);
  });

  it("recognises itself, and stops the moment a level is edited", () => {
    const settings = initialSettings();
    expect(activePreset(settings)).toBeUndefined();

    applyPreset(settings, presets[2]);
    expect(activePreset(settings)?.id).toBe("great-war");

    settings.bands[5].glyphs = settings.bands[5].glyphs.slice(0, 1);
    expect(activePreset(settings)).toBeUndefined();
  });
});

describe("presets through a saved project", () => {
  it("survives a round trip, path and all", () => {
    const settings = initialSettings();
    applyPreset(settings, presets[3]);
    const parsed = parseSettings({ version: 1, settings });
    expect(activePreset(parsed)?.id).toBe("nineteen-forty-one");
    expect(parsed.peak).toBeCloseTo(presets[3].peak);
  });

  it("survives a share link, where an uploaded mark would not", () => {
    const settings = initialSettings();
    applyPreset(settings, presets[1]);
    const shared = shareableSettings(settings);
    expect(activePreset(shared)?.id).toBe("eighteen-twelve");
  });

  it("takes the path from this build, never from the file", () => {
    const settings = initialSettings();
    applyPreset(settings, presets[0]);
    const hostile = structuredClone({ version: 1, settings }) as {
      settings: { glyphs: { id: string; source: string }[] };
    };
    const target = hostile.settings.glyphs.find((glyph) => glyph.id.startsWith("preset-"))!;
    target.source = "https://example.invalid/track.png";

    const parsed = parseSettings(hostile);
    const restored = parsed.glyphs.find((glyph) => glyph.id === target.id)!;
    expect(restored.source).toBe(presets[0].glyphs[0].source);
  });

  it("drops a preset id this build does not ship", () => {
    const parsed = parseSettings({
      settings: {
        glyphs: [{ id: "preset-forgery-01", label: "x", kind: "preset", source: "presets/x/1.webp" }],
      },
    });
    expect(parsed.glyphs.some((glyph) => glyph.id === "preset-forgery-01")).toBe(false);
  });
});
