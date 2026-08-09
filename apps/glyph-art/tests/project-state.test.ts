import { describe, expect, it } from "vitest";
import {
  decodeSettings,
  encodeSettings,
  hasCustomMarks,
  parseSettings,
  shareableSettings,
} from "../src/projectState";
import { initialSettings, resampleBands, useGlyphArtStore } from "../src/store";
import { maxBands, maxGrid, minBands, minGrid, type Settings } from "../src/types";

describe("parsing an untrusted project", () => {
  it("rejects anything that is not an object", () => {
    expect(() => parseSettings("nope")).toThrow();
    expect(() => parseSettings(null)).toThrow();
  });

  it("falls back to the defaults for missing fields", () => {
    const settings = parseSettings({});
    expect(settings.grid).toBe(initialSettings().grid);
    expect(settings.bands.length).toBe(initialSettings().bands.length);
  });

  it("clamps numbers into their stated ranges", () => {
    const settings = parseSettings({ grid: 5000, weight: 99, hand: -3, targetFps: 400, hold: 0 });
    expect(settings.grid).toBeLessThanOrEqual(maxGrid);
    expect(settings.grid).toBeGreaterThanOrEqual(minGrid);
    expect(settings.weight).toBeLessThanOrEqual(2.4);
    expect(settings.hand).toBe(0);
    expect(settings.targetFps).toBe(16);
    expect(settings.hold).toBe(1);
  });

  it("ignores a collapsed or reversed levels pair", () => {
    expect(parseSettings({ levels: { min: 0.9, max: 0.1 } }).levels).toEqual({ min: 0, max: 1 });
    expect(parseSettings({ levels: { min: 0.5, max: 0.5 } }).levels).toEqual({ min: 0, max: 1 });
  });

  it("keeps a valid levels pair", () => {
    expect(parseSettings({ levels: { min: 0.2, max: 0.8 } }).levels).toEqual({ min: 0.2, max: 0.8 });
  });

  it("drops band references to marks the project does not carry", () => {
    const settings = parseSettings({
      bands: [{ glyphs: ["ghost"] }, { glyphs: ["mark-blot", "ghost"] }],
    });
    expect(settings.bands[0].glyphs).toEqual([]);
    expect(settings.bands[1].glyphs).toEqual(["mark-blot"]);
  });

  it("falls back to the shipped ramp when every band came back empty", () => {
    const settings = parseSettings({ bands: [{ glyphs: ["ghost"] }, { glyphs: [] }] });
    expect(settings.bands.some((band) => band.glyphs.length > 0)).toBe(true);
  });

  it("refuses a mark whose source is not a data image", () => {
    const settings = parseSettings({
      glyphs: [{ id: "x", label: "x", kind: "file", source: "https://example.com/a.png" }],
      bands: [{ glyphs: [] }, { glyphs: ["x"] }],
    });
    expect(settings.glyphs.some((spec) => spec.id === "x")).toBe(false);
  });

  it("accepts a data-url mark and keeps its band", () => {
    const source = "data:image/png;base64,iVBORw0KGgo=";
    const settings = parseSettings({
      glyphs: [{ id: "x", label: "custom", kind: "file", source }],
      bands: [{ glyphs: [] }, { glyphs: ["x"] }],
    });
    expect(settings.glyphs.find((spec) => spec.id === "x")?.source).toBe(source);
    expect(settings.bands[1].glyphs).toEqual(["x"]);
  });

  it("always leaves the shipped marks available as a fallback", () => {
    const settings = parseSettings({ glyphs: [] });
    expect(settings.glyphs.some((spec) => spec.id === "mark-blot")).toBe(true);
  });

  it("caps the band count", () => {
    const bands = Array.from({ length: 90 }, () => ({ glyphs: ["mark-blot"] }));
    expect(parseSettings({ bands }).bands.length).toBeLessThanOrEqual(maxBands);
  });

  it("ignores a band list too short to be a ramp", () => {
    const settings = parseSettings({ bands: [{ glyphs: ["mark-blot"] }] });
    expect(settings.bands.length).toBeGreaterThanOrEqual(minBands);
  });
});

describe("share links", () => {
  function withUpload(): Settings {
    const settings = initialSettings();
    settings.glyphs.push({
      id: "file-1",
      label: "scan",
      kind: "file",
      source: "data:image/png;base64,iVBORw0KGgo=",
    });
    settings.bands[3].glyphs = ["file-1"];
    return settings;
  }

  it("round-trips the settings", () => {
    const settings = initialSettings();
    settings.grid = 96;
    settings.weight = 1.1;
    settings.rampInvert = true;
    const restored = decodeSettings(encodeSettings(settings));
    expect(restored.grid).toBe(96);
    expect(restored.weight).toBeCloseTo(1.1);
    expect(restored.rampInvert).toBe(true);
  });

  it("leaves uploaded marks out and substitutes a shipped one", () => {
    const shared = shareableSettings(withUpload());
    expect(shared.glyphs.every((spec) => spec.kind === "mark")).toBe(true);
    expect(shared.bands[3].glyphs).not.toContain("file-1");
    expect(shared.bands[3].glyphs.length).toBeGreaterThan(0);
  });

  it("keeps a link short enough to be a link", () => {
    expect(encodeSettings(withUpload()).length).toBeLessThan(4000);
  });

  it("reports when a link would lose something", () => {
    expect(hasCustomMarks(initialSettings())).toBe(false);
    expect(hasCustomMarks(withUpload())).toBe(true);
  });

  it("survives a corrupt payload by throwing rather than loading rubbish", () => {
    expect(() => decodeSettings("not-base64!!")).toThrow();
  });
});

describe("loading a set of marks", () => {
  function spread(fileCount: number, bandCount: number) {
    const settings = initialSettings();
    settings.bands = resampleBands(settings.bands, bandCount);
    const specs = Array.from({ length: fileCount }, (_, index) => ({
      id: `file-${index}`,
      label: `m${index}`,
      kind: "file" as const,
      source: "data:image/png;base64,iVBORw0KGgo=",
    }));
    useGlyphArtStore.setState({ settings });
    useGlyphArtStore.getState().addGlyphs(specs);
    return useGlyphArtStore.getState().settings;
  }

  it("covers every marked band even when there are fewer files than bands", () => {
    const settings = spread(3, 7);
    expect(settings.bands[0].glyphs).toEqual([]);
    for (const band of settings.bands.slice(1)) {
      expect(band.glyphs).toHaveLength(1);
      expect(band.glyphs[0]).toMatch(/^file-/);
    }
  });

  it("keeps the marks in file order, lightest band first", () => {
    const settings = spread(3, 7);
    const order = settings.bands.slice(1).map((band) => band.glyphs[0]);
    expect(order).toEqual(["file-0", "file-0", "file-1", "file-1", "file-2", "file-2"]);
  });

  it("gives one band each when the counts match", () => {
    const settings = spread(6, 7);
    expect(settings.bands.slice(1).map((band) => band.glyphs[0]))
      .toEqual(["file-0", "file-1", "file-2", "file-3", "file-4", "file-5"]);
  });

  it("drops hand-set sizes so the new marks are solved from the curve", () => {
    const settings = spread(3, 7);
    expect(settings.bands.every((band) => band.size === null)).toBe(true);
  });
});
