import { describe, expect, it } from "vitest";
import { exportSvg } from "../src/export/svg";
import { reactionsPreset } from "../src/reactions";
import { vectorContours, mapContours, type VectorContour } from "../src/engine/vector";
import { cellGeometry, glyphPlacements } from "../src/engine/render";
import { solveRamp } from "../src/engine/ramp";
import type { GlyphLibrary, MeasuredGlyph } from "../src/engine/glyphLibrary";
import type { Point, Segment } from "../src/export/trace";
import { initialSettings } from "../src/store";

/** Independent reader for the export's M/l/c/Z, not the native-path parser. */
function readExport(path: string): VectorContour[] {
  const tokens = path.match(/[MlcZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi)!;
  const contours: VectorContour[] = [];
  let index = 0;
  let at: Point = [0, 0];
  let contour: VectorContour;
  const pair = (): Point => [Number(tokens[index++]), Number(tokens[index++])];
  const relative = (): Point => { const delta = pair(); return [at[0] + delta[0], at[1] + delta[1]]; };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") {
      at = pair();
      contour = { start: at, segments: [] };
      contours.push(contour);
    } else if (command === "l") {
      at = relative();
      contour!.segments.push({ kind: "line", to: at });
    } else if (command === "c") {
      const first = relative(), second = relative(), to = relative();
      contour!.segments.push({ kind: "curve", first, second, to });
      at = to;
    } else expect(command).toBe("Z");
  }
  return contours;
}

describe("native reaction SVG fidelity", () => {
  it("exports all 183 original vectors without any bitmap reads or retracing", async () => {
    for (const spec of reactionsPreset.glyphs) {
      const vector = spec.vector!;
      const measured: MeasuredGlyph = {
        spec, density: 0.5, aspect: vector.width / vector.height,
        // Accessing even dimensions is forbidden: export must use the measured
        // coordinate transform and original vector, never its raster source.
        bitmap: new Proxy({} as HTMLCanvasElement, { get() { throw new Error("Native SVG touched its bitmap."); } }),
        box: { x: 0, y: 0, width: vector.width * 2 - 8, height: vector.height * 2 - 12 },
        vectorTransform: { scaleX: 2, scaleY: 2, offsetX: -4, offsetY: -6 },
      };
      const library = { get: () => measured, metrics: () => measured } as unknown as GlyphLibrary;
      const settings = initialSettings();
      settings.glyphs = [spec];
      settings.bands = [{ glyphs: [spec.id], size: 0.9 }];
      settings.hand = 0.6;
      const field = { gridW: 1, gridH: 1, tone: new Float32Array([0.5]), color: new Uint8ClampedArray(3) };
      // A tiny impression makes the old 0.1px rounding plainly fail this test.
      const size = { width: 12, height: 12 };
      const options = { settings, library, field, frame: 0, size };
      const ramp = solveRamp(settings, library.metrics);
      const [placement] = [...glyphPlacements({ ...options, ink: "flat" }, ramp, cellGeometry(settings, 12, 1, 12, 1))];
      expect(placement.rotation).not.toBe(0);
      const expected = mapContours(vectorContours(vector.path), ([x, y]) => {
        const dx = ((x * 2 - 4) / measured.box.width - 0.5) * placement.width;
        const dy = ((y * 2 - 6) / measured.box.height - 0.5) * placement.height;
        const cos = Math.cos(placement.rotation), sin = Math.sin(placement.rotation);
        return [placement.centreX + dx * cos - dy * sin, placement.centreY + dx * sin + dy * cos];
      });
      const svg = await exportSvg(options, spec.label).text();
      expect(svg).not.toMatch(/<(?:image|text|use|symbol|mask|filter)\b|font-family|NaN|Infinity/);
      const actual = readExport(/\sd="([^"]+)"/.exec(svg)![1]);
      expect(actual).toHaveLength(expected.length);
      const point = (got: Point, want: Point) => {
        expect(Math.abs(got[0] - want[0]), spec.id).toBeLessThanOrEqual(0.000501);
        expect(Math.abs(got[1] - want[1]), spec.id).toBeLessThanOrEqual(0.000501);
      };
      for (const [index, contour] of actual.entries()) {
        const original = expected[index];
        point(contour.start, original.start);
        expect(contour.segments).toHaveLength(original.segments.length);
        for (const [segmentIndex, segment] of contour.segments.entries()) {
          const source: Segment = original.segments[segmentIndex];
          expect(segment.kind).toBe(source.kind);
          point(segment.to, source.to);
          if (segment.kind === "curve" && source.kind === "curve") {
            point(segment.first, source.first);
            point(segment.second, source.second);
          }
        }
      }
    }
  });
});
