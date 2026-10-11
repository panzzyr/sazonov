import { afterEach, describe, expect, it, vi } from "vitest";
import { fitSymbolBlend, symbolOpacity } from "../src/engine/symbolBlend";
import { clippedTone } from "../src/engine/backgroundCleanup";
import { cellGeometry, GlyphRenderer, glyphPlacements } from "../src/engine/render";
import { solveRamp } from "../src/engine/ramp";
import type { GlyphLibrary, MeasuredGlyph } from "../src/engine/glyphLibrary";
import { exportSvg } from "../src/export/svg";
import { decodeSettings, encodeSettings, parseSettings } from "../src/projectState";
import { initialSettings, useGlyphArtStore } from "../src/store";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const settings = initialSettings();
  settings.targetFps = 30;
  settings.stillFrames = 120;
  settings.symbolBlend = fitSymbolBlend({ ...settings.symbolBlend, enabled: true }, 120, 30);
  settings.bands = Array.from({ length: 2 }, () => ({ glyphs: [settings.glyphs[0].id], size: 0.5 }));
  const mark: MeasuredGlyph = {
    spec: settings.glyphs[0], density: 1, aspect: 1,
    box: { x: 0, y: 0, width: 10, height: 10 },
    outline: { width: 10, height: 10, contours: [{ start: [0, 0], segments: [
      { kind: "line", to: [10, 0] }, { kind: "line", to: [10, 10] }, { kind: "line", to: [0, 10] },
    ] }] },
  };
  const library = { get: () => mark, metrics: () => mark } as unknown as GlyphLibrary;
  const field = { gridW: 100, gridH: 1, tone: new Float32Array(100).fill(0.5),
    color: new Uint8ClampedArray(300) };
  const placements = (frame: number) => [...glyphPlacements({ settings, field, library, frame, ink: "flat", loopFrames: 120 },
    solveRamp(settings, library.metrics), cellGeometry(settings, 1000, 100, 10, 1))];
  return { settings, library, field, placements };
}

describe("independent symbol appearance", () => {
  it("is disabled for existing projects, with completely opaque placements", () => {
    const { settings, placements } = fixture();
    settings.symbolBlend.enabled = false;
    expect(placements(0)).toHaveLength(100);
    expect(placements(119).every(mark => mark.opacity === 1)).toBe(true);
  });

  it("appears and departs gradually, with an empty first/last frame and a full middle", () => {
    const { placements } = fixture();
    expect(placements(0)).toEqual([]);
    const early = placements(15), late = placements(105);
    expect(early.length).toBeGreaterThan(20);
    expect(early.length).toBeLessThan(80);
    expect(late.length).toBeGreaterThan(20);
    expect(late.length).toBeLessThan(80);
    expect(early.some(mark => mark.opacity > 0 && mark.opacity < 1)).toBe(true);
    expect(placements(60)).toHaveLength(100);
    expect(placements(60).every(mark => mark.opacity === 1)).toBe(true);
    expect(placements(119)).toEqual([]);
    expect(placements(120)).toEqual([]);
    expect(placements(135)).toEqual(placements(15));
  });

  it("does not depend on seeking, glyph shuffle, scatter, or infinite hold; seconds are FPS-independent", () => {
    const { settings } = fixture();
    const opacity = (s = settings, frame = 15) => Array.from({ length: 100 }, (_, cell) => symbolOpacity(s, cell, frame));
    const expected = opacity();
    opacity(settings, 119);
    expect(opacity()).toEqual(expected);
    expect(opacity({ ...settings, glyphSeed: 993, hold: "infinite",
      symbolMotion: { ...settings.symbolMotion, mode: "scatter", amount: 85, interval: 40 } })).toEqual(expected);
    expect(opacity({ ...settings, targetFps: 60 }, 30)).toEqual(expected);
    expect(opacity({ ...settings, seed: 99 })).not.toEqual(expected);
  });

  it("supports appearance-only, reverse/random departure, delays and instant switches", () => {
    const { settings } = fixture();
    settings.symbolBlend.exitEnabled = false;
    expect(symbolOpacity(settings, 3, 300)).toBe(1);
    settings.symbolBlend.enterStart = 2;
    expect(symbolOpacity(settings, 3, 30)).toBe(0);
    settings.symbolBlend.enterDuration = 0;
    expect(symbolOpacity(settings, 3, 60)).toBe(1);
    settings.symbolBlend = { ...settings.symbolBlend, enterStart: 0, enterDuration: 1,
      exitStart: 2, exitDuration: 1, exitEnabled: true, fade: 0 };
    const exit = () => Array.from({ length: 100 }, (_, cell) => symbolOpacity(settings, cell, 75));
    const same = exit();
    expect(same.every(alpha => alpha === 0 || alpha === 1)).toBe(true);
    settings.symbolBlend.exitOrder = "reverse";
    expect(exit()).toEqual(same.map(alpha => 1 - alpha));
    settings.symbolBlend.exitOrder = "random";
    expect(exit()).not.toEqual(same);
  });

  it("writes the same original paths with per-mark opacity to SVG, not a new raster or trace", async () => {
    const { settings, field, library, placements } = fixture();
    const svg = (frame: number) => exportSvg({ settings, field, library, frame,
      loopFrames: 120, size: { width: 1000, height: 10 } }, "blend").text();
    const early = placements(15), markup = await svg(15);
    const alpha = [...markup.matchAll(/fill-opacity="([^"]+)"/g)].map(match => Number(match[1]));
    const expected = early.filter(mark => mark.opacity < 1).map(mark => mark.opacity);
    expect(alpha).toHaveLength(expected.length);
    expected.forEach((value, index) => expect(alpha[index]).toBeCloseTo(value, 6));
    expect(markup).not.toMatch(/<(?:image|mask|use|text)\b|NaN|Infinity/);
    expect(await svg(0)).not.toContain("<path");
    expect(await svg(119)).toEqual(await svg(0));
    expect((await svg(60)).match(/<path/g)).toHaveLength(1);
  });

  it("stamps Canvas with per-cell alpha then restores full opacity before coloring/composition", () => {
    const { settings, field, library, placements } = fixture();
    const alphas: number[] = [], painting: number[] = [];
    const context = () => ({ globalAlpha: 1, setTransform() {}, clearRect() {}, save() {}, restore() {},
      translate() {}, scale() {}, fill() { alphas.push(this.globalAlpha); },
      fillRect() { painting.push(this.globalAlpha); }, drawImage() { painting.push(this.globalAlpha); } });
    const canvas = () => ({ width: 0, height: 0, getContext: context }) as unknown as HTMLCanvasElement;
    // Real canvases return the same context, not a new one on each call.
    const persistent = () => { const ctx = context(); return { ...canvas(), getContext: () => ctx } as unknown as HTMLCanvasElement; };
    vi.stubGlobal("document", { createElement: persistent });
    vi.stubGlobal("Path2D", class { moveTo() {} lineTo() {} closePath() {} });
    new GlyphRenderer(persistent()).render({ settings, field, library, frame: 15, ink: "flat",
      loopFrames: 120, size: { width: 1000, height: 10 } });
    expect(alphas).toEqual(placements(15).map(mark => mark.opacity));
    expect(painting.every(alpha => alpha === 1)).toBe(true);
  });
});

describe("background and tiny-mark cleanup", () => {
  it("is opt-in; exact endpoint filtering and tolerance are independent", () => {
    const cleanup = initialSettings().cleanup;
    expect(clippedTone(0, cleanup)).toBe(false);
    expect(clippedTone(1, cleanup)).toBe(false);
    expect(clippedTone(0, { ...cleanup, black: true, blackTolerance: 0 })).toBe(true);
    expect(clippedTone(0.001, { ...cleanup, black: true, blackTolerance: 0 })).toBe(false);
    expect(clippedTone(1, { ...cleanup, white: true, whiteTolerance: 0 })).toBe(true);
    expect(clippedTone(0.99, { ...cleanup, white: true })).toBe(true);
    expect(clippedTone(0.99, { ...cleanup, black: true })).toBe(false);
  });

  it("clips raw cells before levels/inversion, identically in geometry and SVG", async () => {
    const { settings, field, library, placements } = fixture();
    settings.symbolBlend.enabled = false;
    field.tone.set([0, 0.01, 0.2, 0.5, 0.99, 1]);
    settings.cleanup.black = settings.cleanup.white = true;
    settings.levels = { min: 0.3, max: 0.7 };
    for (const invert of [false, true]) for (const rampInvert of [false, true]) {
      settings.invert = invert; settings.rampInvert = rampInvert;
      const cells = placements(0).map(mark => mark.cellIndex);
      expect(cells).not.toContain(0); expect(cells).not.toContain(1);
      expect(cells).not.toContain(4); expect(cells).not.toContain(5);
      expect(cells).toContain(2); expect(cells).toContain(3);
      const svg = await exportSvg({ settings, field, library, frame: 0,
        size: { width: 1000, height: 10 } }, "cleanup").text();
      const data = [...svg.matchAll(/\sd="([^"]+)"/g)].map(match => match[1]).join("");
      expect((data.match(/M/g) ?? []).length).toBe(cells.length);
    }
    settings.cleanup.minSize = 0.6;
    expect(placements(0)).toEqual([]);
  });
});

describe("portable blend and cleanup settings", () => {
  it("preserves JSON/links and leaves legacy projects unchanged", () => {
    const { settings } = fixture();
    settings.cleanup.black = true;
    settings.cleanup.whiteTolerance = 0.075;
    expect(parseSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
    expect(decodeSettings(encodeSettings(settings))).toEqual(settings);
    expect(parseSettings({}).symbolBlend).toEqual(initialSettings().symbolBlend);
    expect(parseSettings({}).cleanup).toEqual(initialSettings().cleanup);
  });

  it("validates untrusted values without truthy-string toggles or nonfinite timings", () => {
    const settings = parseSettings({ symbolBlend: { enabled: "true", enterStart: NaN,
      enterDuration: -3, exitStart: Infinity, exitDuration: 99999, fade: 9, exitOrder: "no" },
    cleanup: { black: "true", white: 1, blackTolerance: -1, whiteTolerance: 1, minSize: -1 } });
    expect(settings.symbolBlend).toEqual({ ...initialSettings().symbolBlend, enterDuration: 0, exitDuration: 99999, fade: 5 });
    expect(settings.cleanup).toEqual({ ...initialSettings().cleanup, blackTolerance: 0, whiteTolerance: 0.49 });
  });

  it("starts a usable empty-to-empty still clip in one undo; re-enabling preserves custom timings", () => {
    const store = useGlyphArtStore.getState();
    store.reset();
    const before = useGlyphArtStore.getState().settings;
    store.enableSymbolBlend(48, true);
    const after = useGlyphArtStore.getState().settings;
    expect(after.stillFrames).toBe(48);
    expect(after.symbolBlend.enabled).toBe(true);
    expect(after.symbolBlend.exitStart + after.symbolBlend.exitDuration).toBeCloseTo(47 / 12);
    store.undo();
    expect(useGlyphArtStore.getState().settings).toEqual(before);
    store.redo();
    expect(useGlyphArtStore.getState().settings).toEqual(after);
    store.setGlobal("symbolBlend", { ...after.symbolBlend, enabled: false, enterStart: 0.5 });
    store.enableSymbolBlend(48, true);
    expect(useGlyphArtStore.getState().settings.symbolBlend.enterStart).toBe(0.5);
    store.reset();
    store.enableSymbolBlend(90, false);
    expect(useGlyphArtStore.getState().settings.stillFrames).toBe(1);
  });
});
