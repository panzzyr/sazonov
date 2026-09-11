import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activePreset,
  applyPreset,
  bandGlyphs,
  levelLabel,
  levelMarks,
  levelToken,
  librarySpecs,
  presetGlyphIds,
  presetLevels,
  presets,
} from "../src/presets";
import { presetData } from "../src/generatedPresets";
import { presetMetrics } from "../src/generatedPresetMetrics";
import { bandCenter, cellCoverage, coverageFor, poolCorrection, solveRamp } from "../src/engine/ramp";
import { initialSettings } from "../src/store";
import { encodeSettings, parseSettings, shareableSettings } from "../src/projectState";
import { defaultSettings } from "../src/types";

const publicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));

/** The build measured every mark; this is the lookup the solver wants. */
const metrics = (id: string) => presetMetrics[id];

/** The set that prints every mark it has, and the three that choose. */
const everySet = presets.find((preset) => preset.id === "eighteen-twelve")!;
const chosenSets = presets.filter((preset) => preset !== everySet);

describe("what a preset ships", () => {
  it("ships the four sets, in ramp order, under names that say which war", () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      "eighteenth-century",
      "eighteen-twelve",
      "great-war",
      "nineteen-forty-one",
    ]);
    expect(presets.map((preset) => preset.label)).toEqual([
      "18th century",
      "1812 · Patriotic War",
      "1914 · First World War",
      "1941 · Great Patriotic War",
    ]);
  });

  it.each(presets)("$label has twelve levels", (preset) => {
    expect(preset.levels).toHaveLength(presetLevels);
    expect(presetLevels).toBe(12);
  });

  it.each(chosenSets)("$label puts at least two different marks on every level", (preset) => {
    for (const level of preset.levels) {
      expect(new Set(level).size).toBeGreaterThanOrEqual(2);
    }
  });

  it.each(chosenSets)("$label puts at least four on each of the darkest three", (preset) => {
    for (const level of preset.levels.slice(-3)) {
      expect(new Set(level).size).toBeGreaterThanOrEqual(4);
    }
  });

  it.each(chosenSets)("$label reuses marks, because it has fewer than the ramp has places", (preset) => {
    // A hand-picked set has fewer marks than a twelve-level ramp has places, so
    // marks serve two or three levels at different sizes — that reuse is where
    // its variety comes from.
    const slots = preset.levels.reduce((total, level) => total + level.length, 0);
    expect(preset.glyphs.length).toBeLessThan(slots);
    expect(new Set(preset.levels.flat()).size).toBeLessThan(slots);
  });

  it("prints every mark of 1812, each on exactly one level", () => {
    const placed = everySet.levels.flat();
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed.length).toBe(everySet.glyphs.length);
    // The hand-picked scans and the case of type cut from four newspaper pages.
    expect(everySet.glyphs.length).toBeGreaterThan(2800);
    expect(everySet.glyphs.some((glyph) => glyph.id === "preset-eighteen-twelve-n01")).toBe(true);
    expect(everySet.glyphs.some((glyph) => glyph.id.startsWith("preset-eighteen-twelve-europe-"))).toBe(true);
  });

  it("gives every level of 1812 a deep pool, the dark end included", () => {
    for (const level of everySet.levels) expect(level.length).toBeGreaterThanOrEqual(50);
  });

  it.each(presets)("$label only names marks it carries", (preset) => {
    const known = new Set(preset.glyphs.map((glyph) => glyph.id));
    for (const id of preset.levels.flat()) expect(known.has(id)).toBe(true);
    for (const glyph of preset.glyphs) expect(presetMetrics[glyph.id]).toBeDefined();
  });

  it.each(presets)("$label packs its marks onto sheets that exist, by relative path", (preset) => {
    const { sheets } = presetData.find((data) => data.id === preset.id)!;
    for (const sheet of sheets) {
      // Relative, so the sub-path deployment works; and nothing that could
      // send the browser off this origin.
      expect(sheet.startsWith(`presets/${preset.id}/`)).toBe(true);
      expect(sheet).not.toMatch(/^[a-z]+:|^\/\/|\.\./);
      expect(existsSync(path.join(publicRoot, sheet))).toBe(true);
    }
    for (const glyph of preset.glyphs) {
      expect(glyph.kind).toBe("preset");
      expect(sheets).toContain(glyph.source);
      const [x, y, width, height] = glyph.rect!;
      expect(Math.min(x, y)).toBeGreaterThanOrEqual(0);
      expect(Math.min(width, height)).toBeGreaterThan(0);
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
    const ramp = solveRamp(settings, metrics);

    for (const [index, level] of preset.levels.entries()) {
      const reference = presetMetrics[level[0]];
      for (const id of level) {
        // The size the renderer will actually draw: the band's size, corrected
        // for this mark's own coverage. This is the promise that a preset mark
        // never spills past the ceiling and never clips.
        const size = ramp[index].size * poolCorrection(reference, presetMetrics[id]);
        expect(size).toBeLessThanOrEqual(preset.maxSize + 1e-9);
        expect(size).toBeGreaterThan(0.1);
      }
    }
  });

  it.each(presets)("$label prints the same ink from every mark on a level", (preset) => {
    const settings = initialSettings();
    applyPreset(settings, preset);
    const ramp = solveRamp(settings, metrics);

    for (const [index, level] of preset.levels.entries()) {
      const reference = presetMetrics[level[0]];
      const target = cellCoverage(reference.density, reference.aspect) * ramp[index].size ** 2;
      for (const id of level) {
        const mark = presetMetrics[id];
        const size = ramp[index].size * poolCorrection(reference, mark);
        expect(cellCoverage(mark.density, mark.aspect) * size ** 2).toBeCloseTo(target, 6);
      }
    }
  });

  it("gives an airier set a lower peak than a solid one", () => {
    const light = presets.find((preset) => preset.id === "eighteenth-century")!;
    expect(light.peak).toBeLessThan(everySet.peak);
  });

  it("sorts wide marks onto the light end of 1812", () => {
    // A mark is fitted into its square cell by its long side, so a wide one
    // reaches only part of the cell the other way and inks proportionally less.
    // Nothing sorts for this — it falls out of dealing the densest marks to the
    // darkest levels — and on a set of nearly three thousand marks, whose
    // proportions run from square to two-and-a-half to one, it is plain in the
    // data. The hand-picked sets are too small a sample to show it; the
    // mechanism itself is asserted in `ramp.test.ts`.
    const elongation = everySet.levels.map((level) => {
      const ratios = level.map((id) => {
        const { aspect } = presetMetrics[id];
        return Math.max(aspect, 1 / aspect);
      });
      return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
    });
    const lightest = elongation.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
    const darkest = elongation.slice(-3).reduce((a, b) => a + b, 0) / 3;
    expect(lightest).toBeGreaterThan(darkest * 1.2);
  });
});

describe("applying a preset", () => {
  it("changes the marks and the ramp, and nothing about the picture", () => {
    const settings = initialSettings();
    settings.grid = 120;
    settings.spacing = { x: 0.5, y: 1 };
    settings.invert = true;
    settings.rampInvert = true;
    settings.levels = { min: 0.2, max: 0.8 };
    settings.hand = 0.4;

    applyPreset(settings, presets[0]);

    expect(settings.bands).toHaveLength(presetLevels);
    expect(settings.peak).toBe(presets[0].peak);
    expect(settings.maxSize).toBe(presets[0].maxSize);
    expect(settings.grid).toBe(120);
    expect(settings.spacing).toEqual({ x: 0.5, y: 1 });
    expect(settings.invert).toBe(true);
    expect(settings.rampInvert).toBe(true);
    expect(settings.levels).toEqual({ min: 0.2, max: 0.8 });
    expect(settings.hand).toBe(0.4);
  });

  it("puts one level reference on each band, and copies no marks into the project", () => {
    const settings = initialSettings();
    const before = settings.glyphs.length;
    applyPreset(settings, everySet);

    expect(settings.glyphs).toHaveLength(before);
    settings.bands.forEach((band, index) => {
      expect(band.glyphs).toEqual([levelToken(everySet.id, index)]);
      expect(bandGlyphs(band)).toEqual(everySet.levels[index]);
    });
  });

  it("loads every mark the references stand for, from the build", () => {
    const settings = initialSettings();
    applyPreset(settings, everySet);
    const specs = librarySpecs(settings);
    const loaded = new Set(specs.map((spec) => spec.id));
    for (const glyph of everySet.glyphs) expect(loaded.has(glyph.id)).toBe(true);
    // Once each, and the project's own marks as well.
    expect(specs).toHaveLength(settings.glyphs.length + everySet.glyphs.length);
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

    settings.bands[5].glyphs = [...settings.bands[5].glyphs, "mark-blot"];
    expect(activePreset(settings)).toBeUndefined();
  });
});

describe("level references", () => {
  it("stand for a level of a set this build ships, and nothing else", () => {
    expect(levelMarks(levelToken("great-war", 11))).toEqual(presets[2].levels[11]);
    for (const id of [
      "level:forgery:3",
      "level:great-war:12",
      "level:great-war:-1",
      "level:great-war:1x",
      "level:great-war",
      "preset-great-war-01",
      "mark-blot",
    ]) {
      expect(levelMarks(id)).toBeUndefined();
    }
  });

  it("are named for the interface by set and level", () => {
    expect(levelLabel(levelToken("eighteen-twelve", 4))).toBe("1812 · Patriotic War · level 4");
    expect(levelLabel("mark-blot")).toBeUndefined();
  });

  it("leave a band's own marks alone when mixed with them", () => {
    const band = { glyphs: [levelToken("great-war", 2), "mark-blot"], size: null };
    expect(bandGlyphs(band)).toEqual([...presets[2].levels[2], "mark-blot"]);
  });
});

describe("presets through a saved project", () => {
  it("survives a round trip, and stays small doing it", () => {
    // Before level references, 1812's marks were written into every saved
    // project as ids — and cut at 64 marks when the project was read back.
    const settings = initialSettings();
    applyPreset(settings, everySet);
    const saved = JSON.stringify({ version: 1, settings });
    const parsed = parseSettings(JSON.parse(saved));
    expect(activePreset(parsed)?.id).toBe("eighteen-twelve");
    expect(parsed.peak).toBeCloseTo(everySet.peak);
    expect(saved.length).toBeLessThan(20_000);
  });

  it("survives a share link, which stays a link", () => {
    const settings = initialSettings();
    applyPreset(settings, everySet);
    expect(activePreset(shareableSettings(settings))?.id).toBe("eighteen-twelve");
    expect(encodeSettings(settings).length).toBeLessThan(8_000);
  });

  it("takes a preset mark's path and box from this build, never from the file", () => {
    const settings = initialSettings();
    const shipped = presets[0].glyphs[0];
    settings.glyphs.push({ ...shipped, source: "https://example.invalid/track.png", rect: [0, 0, 9999, 9999] });
    settings.bands[1].glyphs = [shipped.id];

    const restored = parseSettings({ version: 1, settings }).glyphs.find((glyph) => glyph.id === shipped.id)!;
    expect(restored.source).toBe(shipped.source);
    expect(restored.rect).toEqual(shipped.rect);
  });

  it("drops a preset id this build does not ship", () => {
    const parsed = parseSettings({
      settings: {
        glyphs: [{ id: "preset-forgery-01", label: "x", kind: "preset", source: "presets/x/1.webp" }],
      },
    });
    expect(parsed.glyphs.some((glyph) => glyph.id === "preset-forgery-01")).toBe(false);
  });

  it("drops a level reference this build does not ship", () => {
    const parsed = parseSettings({
      settings: {
        bands: [
          { glyphs: ["level:forgery:3"] },
          { glyphs: ["level:great-war:99", levelToken("great-war", 1)] },
        ],
      },
    });
    const kept = parsed.bands.flatMap((band) => band.glyphs);
    expect(kept).not.toContain("level:forgery:3");
    expect(kept).not.toContain("level:great-war:99");
    expect(kept).toContain(levelToken("great-war", 1));
  });
});
