import { afterEach, describe, expect, it, vi } from "vitest";
import { initialSettings, useGlyphArtStore } from "../src/store";
import { decodeSettings, encodeSettings, parseSettings } from "../src/projectState";
import { freshSeed } from "../src/engine/hash";
import { cellGeometry, glyphPlacements } from "../src/engine/render";
import { solveRamp } from "../src/engine/ramp";
import { applyPreset, findPreset, librarySpecs } from "../src/presets";
import { presetMetrics } from "../src/generatedPresetMetrics";
import type { GlyphLibrary, MeasuredGlyph } from "../src/engine/glyphLibrary";
import type { Settings } from "../src/types";
import { exportSvg } from "../src/export/svg";

afterEach(() => {
  vi.restoreAllMocks();
  useGlyphArtStore.setState({ settings: initialSettings(), past: [], future: [], lastEditKey: "" });
});

function placements(settings: Settings, frame = 0) {
  const glyphs = librarySpecs(settings).map((spec): MeasuredGlyph => ({
    spec,
    ...(presetMetrics[spec.id] ?? { density: 0.5, aspect: 1 }),
    bitmap: { width: 30, height: 30 } as HTMLCanvasElement,
    box: { x: 0, y: 0, width: 30, height: 30 },
  }));
  const byId = new Map(glyphs.map((glyph) => [glyph.spec.id, glyph]));
  const library = { get: (id: string) => byId.get(id), metrics: (id: string) => byId.get(id) } as GlyphLibrary;
  const field = { gridW: 30, gridH: 40, tone: new Float32Array(1200).fill(0.45), color: new Uint8ClampedArray(3600) };
  const options = { settings, library, field, frame, ink: "flat" as const, size: { width: 900, height: 1200 } };
  const draw = [...glyphPlacements(options, solveRamp(settings, library.metrics), cellGeometry(settings, 900, 30))];
  return { draw, options };
}

describe("symbol-only shuffle", () => {
  it("freezes preview and SVG selections across time but keeps explicit shuffle available", async () => {
    const settings = initialSettings();
    applyPreset(settings, findPreset("digital-reactions")!);
    settings.hold = "infinite";
    const first = placements(settings, 0);
    const last = placements(settings, 239);
    expect(last.draw).toEqual(first.draw);
    const svg = await exportSvg(first.options, "frozen symbols").text();
    expect(await exportSvg(last.options, "frozen symbols").text()).toBe(svg);
    expect(placements({ ...settings, glyphSeed: 3814 }, 239).draw).not.toEqual(first.draw);
  });

  it("undoes infinite hold and frame-rate edits without changing animation or duration", () => {
    const settings = initialSettings();
    settings.stillFrames = 120;
    settings.animation.enabled = true;
    useGlyphArtStore.setState({ settings, past: [], future: [] });
    useGlyphArtStore.getState().setGlobal("hold", "infinite");
    useGlyphArtStore.getState().setGlobal("targetFps", 60);
    const next = useGlyphArtStore.getState().settings;
    expect(next.hold).toBe("infinite");
    expect(next.targetFps).toBe(60);
    expect(next.stillFrames).toBe(120);
    expect(next.animation).toEqual(settings.animation);
    useGlyphArtStore.getState().undo();
    expect(useGlyphArtStore.getState().settings.targetFps).toBe(settings.targetFps);
    expect(useGlyphArtStore.getState().settings.hold).toBe("infinite");
    useGlyphArtStore.getState().undo();
    expect(useGlyphArtStore.getState().settings).toEqual(settings);
    useGlyphArtStore.getState().redo();
    expect(useGlyphArtStore.getState().settings.hold).toBe("infinite");
  });
  it("changes only the symbol seed, and each click has its own undo step", () => {
    const settings = initialSettings();
    settings.hand = 0.7;
    useGlyphArtStore.setState({ settings, past: [], future: [] });
    useGlyphArtStore.getState().shuffleSymbols();
    const first = useGlyphArtStore.getState().settings;
    expect(first.glyphSeed).not.toBe(settings.glyphSeed);
    expect({ ...first, glyphSeed: settings.glyphSeed }).toEqual(settings);
    useGlyphArtStore.getState().shuffleSymbols();
    const second = useGlyphArtStore.getState().settings;
    expect(second.glyphSeed).not.toBe(first.glyphSeed);
    useGlyphArtStore.getState().undo();
    expect(useGlyphArtStore.getState().settings).toEqual(first);
    useGlyphArtStore.getState().undo();
    expect(useGlyphArtStore.getState().settings).toEqual(settings);
    useGlyphArtStore.getState().redo();
    expect(useGlyphArtStore.getState().settings).toEqual(first);
  });

  it("makes even a repeated entropy draw change the seed", () => {
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 42;
      return array;
    });
    expect(freshSeed(42)).toBe(43);
    expect(freshSeed(41)).toBe(42);
  });

  it("rerolls automatically on each preset choice, including the same preset again", () => {
    const preset = findPreset("crimean")!;
    useGlyphArtStore.getState().usePreset(preset);
    const first = useGlyphArtStore.getState().settings;
    useGlyphArtStore.getState().usePreset(preset);
    const second = useGlyphArtStore.getState().settings;
    expect(second.glyphSeed).not.toBe(first.glyphSeed);
    expect(second.bands).toEqual(first.bands);
    expect(second.seed).toBe(first.seed);
  });

  it("shuffles a changed step collection, but not a direction or blend edit", () => {
    useGlyphArtStore.getState().enableSpatialGradient(true);
    const first = useGlyphArtStore.getState().settings;
    useGlyphArtStore.getState().setGlobal("gradient", { ...first.gradient, direction: "right" });
    expect(useGlyphArtStore.getState().settings.glyphSeed).toBe(first.glyphSeed);
    useGlyphArtStore.getState().setGlobal("gradient", { ...first.gradient, steps: [...first.gradient.steps].reverse() });
    expect(useGlyphArtStore.getState().settings.glyphSeed).not.toBe(first.glyphSeed);
  });

  it("chooses new impressions, including marks that were not previously visible, without moving cells", () => {
    const settings = initialSettings();
    applyPreset(settings, findPreset("crimean")!);
    settings.hand = 0.6;
    const first = placements(settings).draw;
    const second = placements({ ...settings, glyphSeed: 93751 }).draw;
    expect(second).toHaveLength(first.length);
    const positions = (draw: typeof first) => draw.map(({ cellIndex, centreX, centreY, rotation }) =>
      ({ cellIndex, centreX, centreY, rotation }));
    expect(positions(second)).toEqual(positions(first));
    expect(second.filter((mark, index) => mark.glyph.spec.id !== first[index].glyph.spec.id).length)
      .toBeGreaterThan(first.length * 0.9);
    const before = new Set(first.map((mark) => mark.glyph.spec.id));
    expect(second.some((mark) => !before.has(mark.glyph.spec.id))).toBe(true);
    expect(placements(settings).draw).toEqual(first);
  });

  it("keeps spatial step identity while shuffling each step's full pool", () => {
    const settings = initialSettings();
    settings.gradient = { enabled: true, direction: "down", blend: 1, steps: ["great-patriotic", "civil"] };
    const first = placements(settings).draw;
    const second = placements({ ...settings, glyphSeed: 98213 }).draw;
    const identity = (id: string) => id.includes("civil-war") ? "civil" : "wwii";
    expect(second.map((mark) => identity(mark.glyph.spec.id)))
      .toEqual(first.map((mark) => identity(mark.glyph.spec.id)));
  });

  it("keeps single-mark bands unchanged", () => {
    const settings = initialSettings();
    expect(placements({ ...settings, glyphSeed: 128 }).draw).toEqual(placements(settings).draw);
  });

  it("keeps both seeds through files and links, and migrates old projects from their single seed", () => {
    const settings = { ...initialSettings(), seed: 123, glyphSeed: 789 };
    expect(parseSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
    expect(parseSettings({ seed: 123 }).glyphSeed).toBe(123);
    expect(parseSettings({ glyphSeed: -1 }).glyphSeed).toBe(0);
    expect(parseSettings({ glyphSeed: "bad", seed: 123 }).glyphSeed).toBe(123);
  });

  it("uses the same stable symbol seed in the shared placement and native SVG exporters", async () => {
    const settings = initialSettings();
    applyPreset(settings, findPreset("digital-reactions")!);
    settings.glyphSeed = 371;
    const original = placements(settings);
    const first = await exportSvg(original.options, "shuffle").text();
    expect(await exportSvg(placements(settings).options, "shuffle").text()).toBe(first);
    expect(await exportSvg(placements({ ...settings, glyphSeed: 591 }).options, "shuffle").text()).not.toBe(first);
    expect(first).not.toMatch(/<(?:text|image|use|mask)\b|NaN|Infinity/);
  });
});
