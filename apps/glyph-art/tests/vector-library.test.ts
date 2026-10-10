import { describe, expect, it, vi, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { traceGlyph, unpackOutline, outlineDensity } from "../src/engine/glyphOutline";
import { GlyphLibrary, drawGlyph, glyphOutline, type MeasuredGlyph } from "../src/engine/glyphLibrary";
import { vectorContours } from "../src/engine/vector";
import { historicalPresets, librarySpecs, findPreset, applyPreset } from "../src/presets";
import { churchSlavonicPreset } from "../src/churchSlavonic";
import { initialSettings } from "../src/store";
import { exportSvg } from "../src/export/svg";
import type { PackedOutline } from "../src/engine/glyphOutline";

afterEach(() => vi.unstubAllGlobals());

const directory = new URL("../src/preset-vectors/", import.meta.url);
const catalogue = new Map(readdirSync(directory).map(name => {
  const source = readFileSync(new URL(name, directory), "utf8");
  return [name.slice(0, -3), JSON.parse(source.slice(source.indexOf("export default ") + 15).trim().slice(0, -1)) as PackedOutline[]];
}));

describe("shared vector glyph library", () => {
  it("has a nonempty outline for every historical and curated symbol, with stable identities", () => {
    expect(catalogue.size).toBe(27);
    expect([...catalogue.values()].reduce((sum, group) => sum + group.length, 0)).toBe(61127);
    const specs = new Map([...historicalPresets, churchSlavonicPreset].flatMap(preset => preset.glyphs.map(spec => [spec.id, spec])));
    expect(specs.size).toBe(61127);
    for (const spec of specs.values()) {
      const [group, index] = spec.vectorPack!;
      const [width, height, density, path] = catalogue.get(group)![index];
      expect(width > 0 && height > 0 && density > 0 && density <= 1, spec.id).toBe(true);
      expect(path, spec.id).toMatch(/^M.*Z$/);
      expect(path, spec.id).not.toMatch(/NaN|Infinity|[a-z<>]/);
    }
    expect([...specs.keys()].some(id => id.endsWith("a0009"))).toBe(false);
  });

  it("reproduces every shipped contour from the committed sheets", () => {
    const output = execFileSync(process.execPath, ["scripts/build-glyph-vectors.mjs", "--check"], {
      cwd: new URL("../../../", import.meta.url), encoding: "utf8", timeout: 60000,
    });
    expect(output).toContain("61127 vectorized scans across 27 groups.");
  }, 65000);

  it("keeps holes and faint marks, but drops blurred fringes instead of blackening them", () => {
    const alpha = new Uint8ClampedArray(20 * 20);
    for (let y = 1; y < 19; y++) for (let x = 1; x < 19; x++) {
      alpha[y * 20 + x] = x < 3 || x > 16 || y < 3 || y > 16 ? 50 : 255;
      if (x >= 7 && x < 13 && y >= 7 && y < 13) alpha[y * 20 + x] = 0;
    }
    const packed = traceGlyph(alpha, 20, 20), outline = unpackOutline(packed);
    expect(outline.contours).toHaveLength(2);
    // Interpolation includes only part of the 50-alpha edge. The full fringe
    // would exceed 0.7; filling the hole would exceed 0.49.
    expect(outlineDensity(outline)).toBeGreaterThan(0.4);
    expect(outlineDensity(outline)).toBeLessThan(0.44);
    const points = outline.contours.flatMap(contour => [contour.start, ...contour.segments.map(segment => segment.to)]);
    expect(Math.min(...points.map(p => p[0]))).toBeGreaterThanOrEqual(2.5);
    expect(Math.max(...points.map(p => p[0]))).toBeLessThanOrEqual(17.5);
    expect(traceGlyph(new Uint8ClampedArray([20]), 1, 1)[2]).toBeGreaterThan(0);
    expect(traceGlyph(new Uint8ClampedArray(4), 2, 2)[3]).toBe("");
  });

  it("loads presets without decoding a raster and reuses contours for SVG at any size", async () => {
    vi.stubGlobal("Image", class { constructor() { throw new Error("Preset decoded a raster."); } });
    vi.stubGlobal("document", { createElement() { throw new Error("Preset read pixels."); } });
    const library = new GlyphLibrary(), specs = churchSlavonicPreset.glyphs;
    const progress = vi.fn();
    await library.ensure(specs, progress);
    expect(progress).toHaveBeenLastCalledWith(103, 103);
    const settings = initialSettings();
    settings.glyphs = [specs[0]]; settings.bands = [{ glyphs: [specs[0].id], size: 0.9 }];
    const field = { gridW: 1, gridH: 1, tone: new Float32Array([0.5]), color: new Uint8ClampedArray(3) };
    const glyph = library.get(specs[0].id)!;
    expect(glyph.bitmap).toBeUndefined();
    const outline = glyphOutline(glyph);
    for (const size of [24, 100, 4096]) {
      const svg = await exportSvg({ settings, field, library, frame: 0, size: { width: size, height: size } }, "vector").text();
      expect(svg).toContain('<path');
      expect(svg).not.toMatch(/<(?:image|text|use|symbol)\b|NaN|Infinity/);
      expect(glyphOutline(glyph)).toBe(outline);
    }
    const read = vi.spyOn(outline, "contours", "get");
    await library.ensure(specs);
    expect(read).not.toHaveBeenCalled();
    expect(glyphOutline(library.get(specs[0].id)!)).toBe(outline);
    await library.ensure([specs[1]]);
    expect(library.has(specs[0].id)).toBe(false);
  });

  it("draws cached Path2D curves, never the bitmap, and leaves the caller's transform intact", () => {
    const constructor = vi.fn();
    vi.stubGlobal("Path2D", class {
      constructor() { constructor(); }
      moveTo = vi.fn(); lineTo = vi.fn(); bezierCurveTo = vi.fn(); closePath = vi.fn();
    });
    const context = { save: vi.fn(), restore: vi.fn(), translate: vi.fn(), scale: vi.fn(),
      fill: vi.fn(), drawImage: vi.fn(), fillStyle: "#fff" };
    const glyph: MeasuredGlyph = { spec: churchSlavonicPreset.glyphs[0], density: 0.5, aspect: 2,
      box: { x: 0, y: 0, width: 20, height: 10 }, outline: { width: 20, height: 10,
        contours: vectorContours("M0 0C0 5 20 5 20 0L0 0Z") } };
    const draw = (w: number) => drawGlyph(context as unknown as CanvasRenderingContext2D, glyph, 5, 7, w, w / 2);
    draw(100); draw(1000);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.scale.mock.calls).toEqual([[5, 5], [50, 50]]);
    expect(context.save).toHaveBeenCalledTimes(2); expect(context.restore).toHaveBeenCalledTimes(2);
    expect(context.fill).toHaveBeenCalledWith(expect.anything(), "nonzero");
  });

  it("expands historical and native gradient pools without changing selection semantics", () => {
    const settings = initialSettings(); applyPreset(settings, findPreset("great-patriotic")!);
    settings.gradient = { enabled: true, direction: "right", blend: 0.5,
      steps: ["great-patriotic", "church-slavonic-vedomosti", "digital-reactions"] };
    const specs = librarySpecs(settings);
    expect(specs.filter(spec => spec.vectorPack).length).toBeGreaterThan(8000);
    expect(specs.filter(spec => spec.vector).length).toBe(183);
  });
});
