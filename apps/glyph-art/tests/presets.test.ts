import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  activePreset,
  applyPreset,
  bandGlyphs,
  findPreset,
  levelLabel,
  levelMarks,
  levelToken,
  librarySpecs,
  presetEraList,
  presetGlyphIds,
  presetLevels,
  presets,
} from "../src/presets";
import { presetGroups, presetSizeAlphabet } from "../src/generatedPresets";
import { presetMetrics } from "../src/generatedPresetMetrics";
import { packShelves } from "../src/sheetPacking";
import { bandCenter, cellCoverage, coverageFor, poolCorrection, solveRamp } from "../src/engine/ramp";
import { initialSettings } from "../src/store";
import { encodeSettings, parseSettings, shareableSettings } from "../src/projectState";
import { defaultSettings } from "../src/types";

const publicRoot = path.resolve(fileURLToPath(new URL("../public", import.meta.url)));

/** The build measured every mark; this is the lookup the solver wants. */
const metrics = (id: string) => presetMetrics[id];

const russianPresets = presets.filter((preset) => preset.variant === "Russian");
const foreignPresets = presets.filter((preset) => preset.variant !== "Russian");
const crimean = findPreset("crimean")!;

/** How many levels each mark of a preset prints on. */
function appearances(preset: (typeof presets)[number]) {
  const count = new Map<string, number[]>();
  preset.levels.forEach((level, index) => {
    for (const id of level) count.set(id, [...(count.get(id) ?? []), index]);
  });
  return count;
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

describe("what the presets ship", () => {
  it("lists the eras in order, each Russian, and with its foreign print where there is some", () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      "northern-and-patriotic",
      "northern-and-patriotic-french",
      "crimean",
      "crimean-english",
      "russo-turkish",
      "russo-turkish-ottoman",
      "russo-japanese-and-great",
      "russo-japanese-and-great-foreign",
      "civil",
      "local-conflicts",
      "local-conflicts-foreign",
      "great-patriotic",
      "great-patriotic-german",
      "cold-war",
      "cold-war-foreign",
    ]);
    expect(presetEraList.map((era) => era.presets.map((preset) => preset.variant))).toEqual([
      ["Russian", "+ French"],
      ["Russian", "+ English"],
      ["Russian", "+ Ottoman"],
      ["Russian", "+ Japanese & German"],
      ["Russian"],
      ["Russian", "+ Spanish, Finnish, Mongolian & Japanese"],
      ["Russian", "+ German"],
      ["Russian", "+ Korean, Vietnamese, Arabic, Hebrew & Dari"],
    ]);
  });

  it.each(presets)("$label has twelve levels", (preset) => {
    expect(preset.levels).toHaveLength(presetLevels);
    expect(presetLevels).toBe(12);
  });

  it.each(russianPresets)("$label prints every one of its marks, and reuses one only on a dark level", (preset) => {
    const seen = appearances(preset);
    expect(seen.size).toBe(preset.glyphs.length);
    expect(seen.size).toBeGreaterThan(2000);
    for (const levels of seen.values()) {
      expect(levels.length).toBeLessThanOrEqual(2);
      if (levels.length === 2) expect(levels[1]).toBeGreaterThanOrEqual(9);
    }
  });

  it.each(presets)("$label gives every level a deep pool", (preset) => {
    // An empty level prints paper: a band of white across the picture's tone.
    for (const level of preset.levels) expect(level.length).toBeGreaterThanOrEqual(40);
  });

  it.each(russianPresets)("$label keeps its darkest levels about as deep as the rest, if its pages are sharp enough", (preset) => {
    // The darkest marks print largest; a shallow dark level is the one where
    // repetition shows. They are topped up by reuse to the median depth — out
    // of the era's sharp marks only, so an era cut from a soft page (1936–1940)
    // has shallower dark levels rather than smudged ones.
    const depth = Math.min(median(preset.levels.slice(0, 9).map((level) => level.length)), 250);
    const sharp = preset.glyphs.filter((glyph) => presetMetrics[glyph.id].blur <= 1.6
      && presetMetrics[glyph.id].edge >= 18).length;
    if (sharp >= depth * 3 * 2) {
      for (const level of preset.levels.slice(-3)) expect(level.length).toBeGreaterThanOrEqual(depth * 0.9);
    }
    for (const level of preset.levels) expect(new Set(level).size).toBe(level.length);
  });

  it.each(foreignPresets)("$label is its era's Russian ramp with foreign marks added", (preset) => {
    const russian = presets.find((entry) => entry.era === preset.era && entry.variant === "Russian")!;
    preset.levels.forEach((level, index) => {
      expect(level.slice(0, russian.levels[index].length)).toEqual(russian.levels[index]);
    });
    expect(preset.peak).toBe(russian.peak);
    expect(preset.foreign.length).toBeGreaterThan(100);
  });

  it.each(foreignPresets)("$label keeps foreign marks under 30% of every level, never its reference", (preset) => {
    const foreign = new Set(preset.foreign);
    for (const level of preset.levels) {
      const count = level.filter((id) => foreign.has(id)).length;
      expect(count / level.length).toBeLessThanOrEqual(0.3 + 1e-9);
      expect(foreign.has(level[0])).toBe(false);
    }
  });

  it.each(presets)("$label only names marks it carries", (preset) => {
    const known = new Set(preset.glyphs.map((glyph) => glyph.id));
    for (const id of preset.levels.flat()) expect(known.has(id)).toBe(true);
    for (const glyph of preset.glyphs) expect(presetMetrics[glyph.id]).toBeDefined();
  });

  it.each(presetGroups)("puts $id on sheets that exist, where the browser will find its marks", (group) => {
    for (const [sheet] of group.sheets) {
      // Relative, so the sub-path deployment works; and nothing that could
      // send the browser off this origin.
      expect(sheet.startsWith(`presets/${group.id}/`)).toBe(true);
      expect(sheet).not.toMatch(/^[a-z]+:|^\/\/|\.\./);
      expect(existsSync(path.join(publicRoot, sheet))).toBe(true);
    }
    // The browser replays the build's packing from the sizes alone. If the two
    // loops ever drift apart, every mark is cut from the wrong place on its
    // sheet — and the first sign is that the sheets come out a different size.
    const sizes: [number, number][] = [];
    for (let index = 0; index < group.sizes.length; index += 2) {
      sizes.push([
        presetSizeAlphabet.indexOf(group.sizes[index]) + 1,
        presetSizeAlphabet.indexOf(group.sizes[index + 1]) + 1,
      ]);
    }
    expect(packShelves(sizes).sheets.map((sheet) => [sheet.width, sheet.height]))
      .toEqual(group.sheets.map(([, width, height]) => [width, height]));
  });

  it("has no id in two groups", () => {
    const marks = presetGroups.reduce((total, group) => total + group.sizes.length / 2, 0);
    expect(presetGlyphIds.size).toBe(marks);
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

  it("sorts wide marks onto the light end of a dealt era", () => {
    // A mark is fitted into its square cell by its long side, so a wide one
    // reaches only part of the cell the other way and inks proportionally less.
    // Nothing sorts for this — it falls out of dealing the densest marks to the
    // darkest levels — and on an era of thousands of marks it is plain in the
    // data. The mechanism itself is asserted in `ramp.test.ts`.
    const elongation = crimean.levels.map((level) => {
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
    applyPreset(settings, crimean);

    expect(settings.glyphs).toHaveLength(before);
    settings.bands.forEach((band, index) => {
      expect(band.glyphs).toEqual([levelToken(crimean.id, index)]);
      expect(bandGlyphs(band)).toEqual(crimean.levels[index]);
    });
  });

  it("loads every mark the references stand for, from the build", () => {
    const settings = initialSettings();
    const preset = findPreset("crimean-english")!;
    applyPreset(settings, preset);
    const specs = librarySpecs(settings);
    const loaded = new Set(specs.map((spec) => spec.id));
    const placed = new Set(preset.levels.flat());
    for (const id of placed) expect(loaded.has(id)).toBe(true);
    // Once each, and the project's own marks as well.
    expect(specs).toHaveLength(settings.glyphs.length + placed.size);
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

    applyPreset(settings, findPreset("russo-turkish-ottoman")!);
    expect(activePreset(settings)?.id).toBe("russo-turkish-ottoman");

    settings.bands[5].glyphs = [...settings.bands[5].glyphs, "mark-blot"];
    expect(activePreset(settings)).toBeUndefined();
  });
});

describe("level references", () => {
  it("stand for a level of a preset this build ships, and nothing else", () => {
    expect(levelMarks(levelToken("civil", 11))).toEqual(findPreset("civil")!.levels[11]);
    for (const id of [
      "level:forgery:3",
      "level:civil:12",
      "level:civil:-1",
      "level:civil:1x",
      "level:civil",
      "preset-civil-war-0",
      "mark-blot",
    ]) {
      expect(levelMarks(id)).toBeUndefined();
    }
  });

  it("are named for the interface by preset and level", () => {
    expect(levelLabel(levelToken("crimean", 4))).toBe("1853–1856 · Crimean War · level 4");
    expect(levelLabel("mark-blot")).toBeUndefined();
  });

  it("leave a band's own marks alone when mixed with them", () => {
    const civil = findPreset("civil")!;
    const band = { glyphs: [levelToken("civil", 2), "mark-blot"], size: null };
    expect(bandGlyphs(band)).toEqual([...civil.levels[2], "mark-blot"]);
  });
});

describe("presets through a saved project", () => {
  it("survives a round trip, and stays small doing it", () => {
    const settings = initialSettings();
    const preset = findPreset("russo-japanese-and-great-foreign")!;
    applyPreset(settings, preset);
    const saved = JSON.stringify({ version: 1, settings });
    const parsed = parseSettings(JSON.parse(saved));
    expect(activePreset(parsed)?.id).toBe(preset.id);
    expect(parsed.peak).toBeCloseTo(preset.peak);
    expect(saved.length).toBeLessThan(20_000);
  });

  it("survives a share link, which stays a link", () => {
    const settings = initialSettings();
    applyPreset(settings, crimean);
    expect(activePreset(shareableSettings(settings))?.id).toBe("crimean");
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
          { glyphs: ["level:civil:99", levelToken("civil", 1)] },
        ],
      },
    });
    const kept = parsed.bands.flatMap((band) => band.glyphs);
    expect(kept).not.toContain("level:forgery:3");
    expect(kept).not.toContain("level:civil:99");
    expect(kept).toContain(levelToken("civil", 1));
  });
});

describe("weighting by letterform", () => {
  it.each(presets)("$label weighs every mark it prints", (preset) => {
    preset.levels.forEach((level, index) => {
      expect(preset.weights[index]).toHaveLength(level.length);
      for (const weight of preset.weights[index]) {
        expect(weight).toBeGreaterThan(0);
        expect(weight).toBeLessThanOrEqual(1);
      }
    });
  });

  it.each(russianPresets)("$label gives every letterform of a level the same total weight", (preset) => {
    // A letterform of k impressions weighs 1/k each, so the marks weighing 1/k
    // come in whole groups of k.
    for (const weights of preset.weights) {
      const counts = new Map<number, number>();
      for (const weight of weights) {
        const group = Math.round(1 / weight);
        counts.set(group, (counts.get(group) ?? 0) + 1);
      }
      for (const [group, count] of counts) if (group < 91) expect(count % group).toBe(0);
    }
  });

  it.each(russianPresets)("$label has far more letterforms on a level than a common letter would show", (preset) => {
    for (const [index, weights] of preset.weights.entries()) {
      const forms = weights.reduce((sum, weight) => sum + weight, 0);
      expect(forms).toBeLessThanOrEqual(preset.levels[index].length + 1e-6);
      expect(forms).toBeGreaterThan(20);
    }
  });

  it.each(foreignPresets)("$label keeps foreign marks under 30% of every level's weight", (preset) => {
    const foreign = new Set(preset.foreign);
    preset.levels.forEach((level, index) => {
      let own = 0;
      let theirs = 0;
      level.forEach((id, position) => {
        if (foreign.has(id)) theirs += preset.weights[index][position];
        else own += preset.weights[index][position];
      });
      expect(theirs / (own + theirs)).toBeLessThanOrEqual(0.3 + 1e-9);
    });
  });
});

describe("the darkest levels", () => {
  it.each(presets)("$label prints only sharp marks on its darkest three", (preset) => {
    // Those levels print a mark at a cell and more. A soft scan stretched that
    // far is a smudge, and a shadow is where the eye finds it. Blur is the
    // width in pixels of the ramp from paper to solid ink across an edge.
    for (const level of preset.levels.slice(-3)) {
      for (const id of level) {
        expect(presetMetrics[id].blur).toBeLessThanOrEqual(1.6);
        expect(presetMetrics[id].edge).toBeGreaterThanOrEqual(18);
      }
    }
  });
});
