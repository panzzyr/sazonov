import { afterEach, describe, expect, it } from "vitest";
import { gradientPosition, gradientStep } from "../src/spatialGradient";
import { applyPreset, defaultGradientSteps, findPreset, historicalPresets, librarySpecs } from "../src/presets";
import { reactionCounts, reactionIcons, reactionShares, reactionsPreset } from "../src/reactions";
import { pressFVector } from "../src/generatedPressF";
import { cumulativeWeights, weightedCycleIndex } from "../src/engine/cellParams";
import { execFileSync } from "node:child_process";
import { decodeSettings, encodeSettings, parseSettings } from "../src/projectState";
import { initialSettings, useGlyphArtStore } from "../src/store";
import { vectorContours } from "../src/engine/vector";
import { cellGeometry, glyphPlacements } from "../src/engine/render";
import { solveRamp } from "../src/engine/ramp";
import type { GlyphLibrary, MeasuredGlyph } from "../src/engine/glyphLibrary";
import { exportSvg } from "../src/export/svg";
import { presetMetrics } from "../src/generatedPresetMetrics";
import { maxGradientSteps, type Settings } from "../src/types";

function gradientSettings(): Settings {
  const settings = initialSettings();
  settings.peak = 0.4;
  settings.gradient = { enabled: true, direction: "down", blend: 0.65, steps: defaultGradientSteps() };
  return settings;
}

/** Native vectors need no DOM for SVG; historical masks are not traced here. */
function libraryFor(settings: Settings): GlyphLibrary {
  const glyphs = librarySpecs(settings).map((spec): MeasuredGlyph => {
    const vector = spec.vector;
    const metric = presetMetrics[spec.id] ?? { density: 0.5, aspect: vector ? vector.width / vector.height : 1 };
    const width = vector?.width ?? 30;
    const height = vector?.height ?? 30;
    return {
      spec, ...metric, bitmap: { width, height } as HTMLCanvasElement,
      box: { x: 0, y: 0, width, height },
    };
  });
  const byId = new Map(glyphs.map((glyph) => [glyph.spec.id, glyph]));
  return { get: (id: string) => byId.get(id), metrics: (id: string) => byId.get(id) } as GlyphLibrary;
}

describe("spatial step selection", () => {
  it("reaches the first and last step in every direction", () => {
    expect(gradientPosition("down", 0, 0, 9, 9)).toBe(0);
    expect(gradientPosition("down", 8, 8, 9, 9)).toBe(1);
    expect(gradientPosition("right", 8, 0, 9, 9)).toBe(1);
    expect(gradientPosition("up", 0, 0, 9, 9)).toBe(1);
    expect(gradientPosition("left", 0, 8, 9, 9)).toBe(1);
    expect(gradientPosition("down", 0, 0, 1, 1)).toBe(0.5);
    for (const cell of [0, 50, 999]) {
      expect(gradientStep(0, 9, 1, 17, cell)).toBe(0);
      expect(gradientStep(1, 9, 1, 17, cell)).toBe(8);
    }
  });

  it("mixes only neighbouring steps, with deterministic equal shares at their boundary", () => {
    const picks = Array.from({ length: 1000 }, (_, cell) => gradientStep(2.5 / 8, 9, 1, 17, cell));
    expect(new Set(picks)).toEqual(new Set([2, 3]));
    expect(picks.filter((step) => step === 3).length).toBeGreaterThan(440);
    expect(picks.filter((step) => step === 3).length).toBeLessThan(560);
    expect(picks).toEqual(Array.from({ length: 1000 }, (_, cell) => gradientStep(2.5 / 8, 9, 1, 17, cell)));
    expect(gradientStep(0.49, 2, 0, 17, 0)).toBe(0);
    expect(gradientStep(0.5, 2, 0, 17, 0)).toBe(1);
  });

  it("includes every historical era once, with WWII then Civil War and digital reactions last", () => {
    const steps = defaultGradientSteps();
    expect(steps.slice(0, 2)).toEqual(["great-patriotic", "civil"]);
    expect(steps.at(-1)).toBe("digital-reactions");
    expect(new Set(steps.slice(0, -1).map((id) => findPreset(id)!.era)))
      .toEqual(new Set(historicalPresets.map((preset) => preset.era)));
    expect(new Set(steps).size).toBe(steps.length);
    const specs = librarySpecs(gradientSettings());
    const ids = new Set(specs.map((spec) => spec.id));
    expect(ids.size).toBe(specs.length);
    for (const id of steps) {
      for (const glyph of findPreset(id)!.glyphs) expect(ids.has(glyph.id)).toBe(true);
    }
  });

  it("places the correct steps at both ends and keeps step identity stable across animation frames", () => {
    const settings = gradientSettings();
    settings.hold = 1;
    settings.gradient.steps = ["great-patriotic", "civil", "digital-reactions"];
    const library = libraryFor(settings);
    const field = { gridW: 10, gridH: 21, tone: new Float32Array(210).fill(0.8), color: new Uint8ClampedArray(630) };
    const draw = (frame: number) => [...glyphPlacements({ settings, library, field, frame, ink: "flat" },
      solveRamp(settings, library.metrics), cellGeometry(settings, 1000, field.gridW))];
    const first = draw(0);
    const next = draw(1);
    const sets = settings.gradient.steps.map((id) => new Set(findPreset(id)!.glyphs.map((glyph) => glyph.id)));
    expect(first).toHaveLength(210);
    for (const placement of first.slice(0, 10)) expect(sets[0].has(placement.glyph.spec.id)).toBe(true);
    for (const placement of first.slice(-10)) expect(sets[2].has(placement.glyph.spec.id)).toBe(true);
    expect(next.map((placement) => sets.findIndex((ids) => ids.has(placement.glyph.spec.id))))
      .toEqual(first.map((placement) => sets.findIndex((ids) => ids.has(placement.glyph.spec.id))));
  });

  it("uses only two chosen steps, with no hidden intermediate eras", () => {
    const settings = gradientSettings();
    settings.gradient.steps = [defaultGradientSteps()[0], "digital-reactions"];
    const library = libraryFor(settings);
    const field = { gridW: 10, gridH: 11, tone: new Float32Array(110).fill(0.6), color: new Uint8ClampedArray(330) };
    const marks = [...glyphPlacements({ settings, library, field, frame: 0, ink: "flat" },
      solveRamp(settings, library.metrics), cellGeometry(settings, 1000, 10))];
    const first = new Set(findPreset(settings.gradient.steps[0])!.glyphs.map((glyph) => glyph.id));
    const last = new Set(reactionsPreset.glyphs.map((glyph) => glyph.id));
    expect(marks).toHaveLength(110);
    for (const mark of marks.slice(0, 10)) expect(first.has(mark.glyph.spec.id)).toBe(true);
    for (const mark of marks.slice(-10)) expect(last.has(mark.glyph.spec.id)).toBe(true);
    for (const mark of marks) expect(first.has(mark.glyph.spec.id) || last.has(mark.glyph.spec.id)).toBe(true);
    const own = new Set(settings.glyphs.map((glyph) => glyph.id));
    for (const glyph of librarySpecs(settings)) expect(own.has(glyph.id) || first.has(glyph.id) || last.has(glyph.id)).toBe(true);
  });
});

describe("digital reaction vectors", () => {
  it("ships only the requested two reactions, views, and 180 distinct exactly-two-digit counters", () => {
    expect(reactionCounts).toHaveLength(180);
    expect(new Set(reactionCounts).size).toBe(180);
    expect(reactionCounts).toContain("1,7k");
    expect(reactionCounts).toContain("17k");
    expect(reactionCounts).not.toContain("17,1k");
    for (const count of reactionCounts) expect(count).toMatch(/^(?:\d\d|\d,\d)k$/);
    expect(reactionsPreset.glyphs.slice(0, 3).map((glyph) => glyph.id))
      .toEqual(["reaction-fire", "reaction-salute", "reaction-eye"]);
    expect(reactionsPreset.glyphs).toHaveLength(183);
    expect(reactionsPreset.glyphs.some((glyph) => glyph.id.startsWith("reaction-views-"))).toBe(false);
    expect(reactionsPreset.glyphs.filter((glyph) => glyph.label.startsWith("views"))).toHaveLength(1);
    const known = new Set(reactionsPreset.glyphs.map((glyph) => glyph.id));
    for (const [index, level] of reactionsPreset.levels.entries()) {
      expect(level.length).toBeGreaterThan(0);
      expect(reactionsPreset.weights[index]).toHaveLength(level.length);
      for (const id of level) expect(known.has(id)).toBe(true);
    }
    for (const glyph of reactionsPreset.glyphs) expect(vectorContours(glyph.vector!.path).length).toBeGreaterThan(0);
  });

  it("uses the owner's press F trace without rasterization or replacement geometry", () => {
    expect(reactionIcons.salute).toBe(pressFVector);
    expect([pressFVector.width, pressFVector.height]).toEqual([150.58, 137.54]);
    expect(vectorContours(pressFVector.path)).toHaveLength(3);
    const regenerated = execFileSync(process.execPath, ["../../scripts/build-press-f.mjs"], { encoding: "utf8" });
    const json = regenerated.slice(regenerated.indexOf(" = ") + 3).trim().replace(/;$/, "");
    expect(JSON.parse(json)).toEqual(pressFVector);
  });

  it("keeps tiny levels free of icons and prints counters on every level, including the darkest", () => {
    for (const [band, level] of reactionsPreset.levels.entries()) {
      const numeric = level.filter((id) => id.startsWith("reaction-count-"));
      expect(numeric).toHaveLength(180);
      if (band < 3) expect(level).toEqual(numeric);
      const total = reactionsPreset.weights[band].reduce((sum, weight) => sum + weight, 0);
      const numberWeight = level.reduce((sum, id, index) =>
        sum + (id.startsWith("reaction-count-") ? reactionsPreset.weights[band][index] : 0), 0);
      expect(total).toBeCloseTo(1);
      expect(numberWeight / total).toBeCloseTo(reactionShares[band].counters);
    }
    const band = 11;
    const pool = reactionsPreset.levels[band];
    const weights = cumulativeWeights(reactionsPreset.weights[band]);
    const picks = Array.from({ length: 4000 }, (_, cell) =>
      pool[weightedCycleIndex(8471, cell, weights, 0, 2)]);
    const fraction = picks.filter((id) => id.startsWith("reaction-count-")).length / picks.length;
    expect(fraction).toBeGreaterThan(0.6);
    expect(fraction).toBeLessThan(0.7);
  });

  it("converts quadratic font curves exactly and retains holes as distinct contours", () => {
    const contours = vectorContours("M0 0Q3 3 6 0ZM1 1L2 1L1 2Z");
    expect(contours).toHaveLength(2);
    expect(contours[0].segments[0]).toEqual({ kind: "curve", first: [2, 2], second: [4, 2], to: [6, 0] });
  });

  it("exports counters and icons as editable paths, without text, fonts, references or bitmaps", async () => {
    const settings = initialSettings();
    applyPreset(settings, reactionsPreset);
    settings.invert = true;
    // Exercise the wide counters, including their holes, not only the icons.
    settings.bands = [
      { glyphs: [reactionsPreset.glyphs[10].id], size: 0.9 },
      { glyphs: [reactionsPreset.glyphs.find((glyph) => glyph.label === "1,7k")!.id], size: 0.9 },
    ];
    settings.glyphs = reactionsPreset.glyphs;
    const library = libraryFor(settings);
    const glyph = library.get(reactionsPreset.glyphs[10].id)!;
    glyph.vectorTransform = { scaleX: 2, scaleY: 2, offsetX: -4, offsetY: -6 };
    glyph.box = { x: 0, y: 0, width: glyph.box.width * 2 - 8, height: glyph.box.height * 2 - 12 };
    const field = { gridW: 2, gridH: 1, tone: new Float32Array([0.25, 0.75]), color: new Uint8ClampedArray(6) };
    const options = { settings, field, library, frame: 0, size: { width: 400, height: 200 } };
    const svg = await exportSvg(options, "test <counter>").text();
    expect(svg).toContain("test &lt;counter&gt;");
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(svg.match(/<path/g)).toHaveLength(1);
    expect(svg).toMatch(/\sd="M[^\"]+c/);
    expect(svg).not.toMatch(/<(?:image|text|use|symbol|mask|filter)\b|font-family|NaN|Infinity/);
    expect(await exportSvg(options, "test <counter>").text()).toBe(svg);
  });
});

describe("gradient project compatibility", () => {
  afterEach(() => useGlyphArtStore.getState().reset());

  it("round-trips gradient direction, order, variants and animation without embedding all preset marks", () => {
    const settings = gradientSettings();
    settings.gradient.direction = "left";
    settings.gradient.steps[0] = "great-patriotic-german";
    settings.animation = { enabled: true, interpolation: "linear", keyframes: [{ at: 0, grid: 200 }, { at: 1, grid: 1 }] };
    const encoded = encodeSettings(settings);
    expect(encoded.length).toBeLessThan(10_000);
    const restored = decodeSettings(encoded);
    expect(restored.gradient).toEqual(settings.gradient);
    expect(restored.animation).toEqual(settings.animation);
    expect(parseSettings({ version: 2, settings }).gradient).toEqual(settings.gradient);
    expect(parseSettings({}).gradient.enabled).toBe(false);
  });

  it("keeps an arbitrary two-step subset through files, links and gradient disable/enable", () => {
    const settings = gradientSettings();
    settings.gradient.steps = ["northern-and-patriotic-french", "digital-reactions"];
    expect(parseSettings({ settings }).gradient).toEqual(settings.gradient);
    expect(decodeSettings(encodeSettings(settings)).gradient).toEqual(settings.gradient);
    useGlyphArtStore.getState().replaceSettings(settings);
    useGlyphArtStore.getState().enableSpatialGradient(false);
    useGlyphArtStore.getState().enableSpatialGradient(true);
    expect(useGlyphArtStore.getState().settings.gradient.steps).toEqual(settings.gradient.steps);
  });

  it("allows repeated and freely ordered steps, capped at the stated maximum", () => {
    const steps = Array.from({ length: maxGradientSteps + 3 }, (_, index) =>
      index % 2 ? "crimean" : "digital-reactions");
    expect(parseSettings({ gradient: { enabled: true, steps } }).gradient.steps)
      .toEqual(steps.slice(0, maxGradientSteps));
  });

  it("collapses to the first and last in one undoable edit without changing custom bands", () => {
    const settings = gradientSettings();
    useGlyphArtStore.setState({ settings, past: [], future: [], lastEditKey: "" });
    const steps = [settings.gradient.steps[0], settings.gradient.steps.at(-1)!];
    useGlyphArtStore.getState().setGlobal("gradient", { ...settings.gradient, steps });
    const reduced = useGlyphArtStore.getState().settings;
    expect(reduced.gradient.steps).toEqual(steps);
    expect(reduced.bands).toEqual(settings.bands);
    expect(reduced.seed).toBe(settings.seed);
    expect(reduced.glyphSeed).not.toBe(settings.glyphSeed);
    useGlyphArtStore.getState().undo();
    expect(useGlyphArtStore.getState().settings.gradient.steps).toEqual(settings.gradient.steps);
    useGlyphArtStore.getState().redo();
    expect(useGlyphArtStore.getState().settings.gradient.steps).toEqual(steps);
  });

  it("rejects external steps and arbitrary vector metadata in untrusted project files", () => {
    const restored = parseSettings({ gradient: {
      enabled: true, direction: "diagonal", blend: 10, steps: ["https://example.com/evil.svg"],
    }, glyphs: [{ ...reactionsPreset.glyphs[0], vector: { path: "bad" }, source: "bad" }] });
    expect(restored.gradient).toEqual({ enabled: true, direction: "down", blend: 1, steps: defaultGradientSteps() });
    expect(restored.glyphs[0]).toEqual(reactionsPreset.glyphs[0]);
    const custom = parseSettings({ glyphs: [{ id: "custom", label: "custom", kind: "mark", source: "<svg/>", vector: { path: "bad" } }] });
    expect(custom.glyphs[0].vector).toBeUndefined();
  });

  it("preserves the custom ramp and supports undo/redo; a single preset disables rather than destroys the gradient", () => {
    const store = useGlyphArtStore.getState();
    store.reset();
    const original = useGlyphArtStore.getState().settings;
    store.enableSpatialGradient(true);
    expect(useGlyphArtStore.getState().settings.bands).toEqual(original.bands);
    store.undo();
    expect(useGlyphArtStore.getState().settings.gradient.enabled).toBe(false);
    store.redo();
    expect(useGlyphArtStore.getState().settings.gradient.enabled).toBe(true);
    const steps = useGlyphArtStore.getState().settings.gradient.steps;
    store.usePreset(findPreset("civil")!);
    expect(useGlyphArtStore.getState().settings.gradient).toEqual({ ...original.gradient, enabled: false, steps });
  });
});
