import { describe, expect, it } from "vitest";
import {
  dotArea,
  dotOutline,
  latticeRange,
  plateColors,
  plateNames,
  screenAngles,
  screenDots,
  screenPitch,
  separate,
  type DotSink,
} from "../src/engine/halftone";
import { sequenceSize } from "../src/export/renderSequence";
import { defaultSettings, halftoneSize, separations } from "../src/types";

const halftone = (overrides: Partial<typeof defaultSettings.halftone> = {}) => ({
  ...defaultSettings.halftone,
  ...overrides,
});

const degrees = (radians: number) => (radians * 180) / Math.PI;

describe("the screen", () => {
  it.each(separations)("%s names, colours and angles agree in number", (separation) => {
    const settings = halftone({ separation });
    const count = screenAngles(settings).length;
    expect(plateNames(settings)).toHaveLength(count);
    expect(plateColors(settings)).toHaveLength(count);
  });

  it("carries the user's rotation into every plate", () => {
    const angles = screenAngles(halftone({ separation: "cmyk", angle: 10 }));
    expect(angles.map(degrees)).toEqual([25, 85, 10, 55]);
  });

  it("keeps the chromatic plates 30° apart, which is what makes a rosette", () => {
    const [cyan, magenta, , black] = screenAngles(halftone({ separation: "cmyk", angle: 0 }))
      .map(degrees);
    expect(Math.abs(magenta - cyan)).toBeCloseTo(60);
    expect(Math.abs(black - cyan)).toBeCloseTo(30);
    expect(Math.abs(magenta - black)).toBeCloseTo(30);
  });

  it("holds the two duotone screens apart too", () => {
    const [first, second] = screenAngles(halftone({ separation: "duotone", angle: 0 })).map(degrees);
    expect(Math.abs(second - first)).toBeCloseTo(30);
  });

  it("uses pure secondaries for process, so the plates subtract correctly", () => {
    expect(plateColors(halftone({ separation: "cmyk" })))
      .toEqual(["#00ffff", "#ff00ff", "#ffff00", "#000000"]);
  });

  it("uses the chosen inks for duotone", () => {
    const inks: [string, string] = ["#102030", "#ff8800"];
    expect(plateColors(halftone({ separation: "duotone", inks }))).toEqual(inks);
  });
});

describe("the lattice", () => {
  it("covers every corner of the frame at any angle", () => {
    const width = 800;
    const height = 500;
    const pitch = 37;

    for (const degrees_ of [0, 15, 45, 75, 90]) {
      const angle = (degrees_ * Math.PI) / 180;
      const range = latticeRange(width, height, pitch, angle);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      let hit = 0;
      for (let v = range.fromV; v <= range.toV; v += 1) {
        for (let u = range.fromU; u <= range.toU; u += 1) {
          const x = (u + 0.5) * pitch * cos - (v + 0.5) * pitch * sin;
          const y = (u + 0.5) * pitch * sin + (v + 0.5) * pitch * cos;
          if (x >= 0 && y >= 0 && x <= width && y <= height) hit += 1;
        }
      }
      // A screen this coarse over this frame is around 300 dots; anything far
      // short of that means the range missed part of the frame.
      expect(hit).toBeGreaterThan((width * height) / pitch ** 2 * 0.9);
    }
  });

  it("reaches past the edges, so a rotated screen has no bald border", () => {
    const range = latticeRange(400, 400, 40, Math.PI / 4);
    expect(range.fromU).toBeLessThan(0);
    expect(range.toU * 40).toBeGreaterThan(400);
  });
});

describe("separation", () => {
  it("leaves paper unprinted and prints solid black on black", () => {
    expect(separate(1, 1, 1, "cmyk", 0.6)).toEqual([0, 0, 0, 0]);
    expect(separate(0, 0, 0, "cmyk", 1)).toEqual([0, 0, 0, 1]);
  });

  it("builds a primary out of the two inks that make it", () => {
    const [cyan, magenta, yellow, black] = separate(1, 0, 0, "cmyk", 0.6);
    expect(cyan).toBeCloseTo(0);
    expect(magenta).toBeCloseTo(1);
    expect(yellow).toBeCloseTo(1);
    expect(black).toBeCloseTo(0);
  });

  it("moves a neutral onto the black plate as black generation rises", () => {
    const rich = separate(0.5, 0.5, 0.5, "cmyk", 0);
    const lean = separate(0.5, 0.5, 0.5, "cmyk", 1);
    expect(rich[3]).toBeCloseTo(0);
    expect(rich[0]).toBeGreaterThan(0.4);
    expect(lean[3]).toBeGreaterThan(0.4);
    expect(lean[0]).toBeCloseTo(0);
  });

  it("gives mono one plate that climbs with darkness", () => {
    expect(separate(1, 1, 1, "mono", 0)[0]).toBeCloseTo(0);
    expect(separate(0, 0, 0, "mono", 0)[0]).toBeCloseTo(1);
    expect(separate(0.25, 0.25, 0.25, "mono", 0)[0])
      .toBeGreaterThan(separate(0.75, 0.75, 0.75, "mono", 0)[0]);
  });

  it("holds the second duotone ink out of the highlights", () => {
    const [dark, light] = separate(0.9, 0.9, 0.9, "duotone", 0);
    expect(dark).toBeGreaterThan(0);
    expect(light).toBeCloseTo(0, 2);
    expect(separate(0, 0, 0, "duotone", 0)[1]).toBeCloseTo(1);
  });
});

describe("tone to dot area", () => {
  it("is the identity at unit gain and stays inside one cell", () => {
    expect(dotArea(0, 1)).toBe(0);
    expect(dotArea(0.4, 1)).toBeCloseTo(0.4);
    expect(dotArea(1, 1)).toBe(1);
    expect(dotArea(4, 1)).toBe(1);
    expect(dotArea(-2, 1)).toBe(0);
  });

  it("opens the shadows below 1 and holds them back above", () => {
    expect(dotArea(0.5, 0.6)).toBeGreaterThan(0.5);
    expect(dotArea(0.5, 1.8)).toBeLessThan(0.5);
  });

  it("climbs for any gain, so the tone never folds back on itself", () => {
    for (const gain of [0.5, 1, 1.45, 2]) {
      let previous = -1;
      for (let step = 0; step <= 20; step += 1) {
        const area = dotArea(step / 20, gain);
        expect(area).toBeGreaterThan(previous);
        previous = area;
      }
    }
  });
});

describe("the halftone frame", () => {
  it("is even on both sides, so H.264 never resizes it", () => {
    for (const width of [1024, 1536, 2048, 3072]) {
      for (const [sourceWidth, sourceHeight] of [[1920, 1080], [1000, 1333], [641, 481]]) {
        const frame = halftoneSize(width, sourceWidth, sourceHeight);
        expect(frame.width % 2).toBe(0);
        expect(frame.height % 2).toBe(0);
      }
    }
  });

  it("keeps the source's proportion", () => {
    const frame = halftoneSize(2048, 1920, 1080);
    expect(frame.width / frame.height).toBeCloseTo(1920 / 1080, 2);
  });

  it("survives a source with no dimensions rather than dividing by zero", () => {
    const frame = halftoneSize(2048, 0, 0);
    expect(frame.width).toBe(2048);
    expect(frame.height).toBe(2048);
  });

  it("is the size the export is told to expect, taken from the source", () => {
    // The renderer used to re-derive the frame from the tone field, whose grid
    // is already a rounding of the source's proportion; on a 1200x800 source
    // that came out two pixels shorter than the size the encoder was
    // configured with. One function answers now, and this is it.
    const settings = { ...defaultSettings, mode: "halftone" as const };
    for (const [width, height] of [[1200, 800], [1920, 1080], [999, 733]]) {
      const source = { kind: "image" as const, bitmap: {} as ImageBitmap, width, height };
      const raster = sequenceSize(source, settings);
      expect(raster).toMatchObject(halftoneSize(settings.outputWidth, width, height));
    }
  });
});

describe("output resolution", () => {
  it("uses the requested width in either mode and keeps both sides even", () => {
    for (const mode of ["glyph", "halftone"] as const) {
      const settings = { ...defaultSettings, mode, outputWidth: 2501 };
      const source = {
        kind: "image" as const,
        bitmap: {} as ImageBitmap,
        width: 1200,
        height: 801,
      };
      const frame = sequenceSize(source, settings);
      expect(frame.width).toBe(2502);
      expect(frame.width % 2).toBe(0);
      expect(frame.height % 2).toBe(0);
    }
  });
});

/** A sink that keeps what it was handed, so the geometry can be measured. */
function recordingSink() {
  const circles: { x: number; y: number; radius: number }[] = [];
  const ellipses: { major: number; minor: number; angle: number }[] = [];
  const polygons: [number, number][][] = [];
  const sink: DotSink = {
    circle: (x, y, radius) => circles.push({ x, y, radius }),
    ellipse: (_x, _y, major, minor, angle) => ellipses.push({ major, minor, angle }),
    polygon: (points) => polygons.push(points),
  };
  return { sink, circles, ellipses, polygons };
}

/** Shoelace, so a polygon can be checked against the area it was solved from. */
function polygonArea(points: [number, number][]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

const flatField = (gridW: number, gridH: number, value: number) => ({
  gridW,
  gridH,
  tone: new Float32Array(gridW * gridH),
  color: new Uint8ClampedArray(gridW * gridH * 3).fill(value),
});

describe("dot geometry", () => {
  it("gives a round dot the area it was solved from", () => {
    const { sink, circles } = recordingSink();
    dotOutline(sink, "round", 10, 20, 8, 0.5, 0);
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({ x: 10, y: 20 });
    expect((Math.PI * circles[0].radius ** 2) / 8 ** 2).toBeCloseTo(0.5, 6);
  });

  it.each([
    ["square", 0.36],
    ["diamond", 0.36],
    ["line", 0.4],
  ] as const)("gives a %s dot the area it was solved from", (shape, area) => {
    const { sink, polygons } = recordingSink();
    dotOutline(sink, shape, 0, 0, 10, area, 0.3);
    expect(polygons).toHaveLength(1);
    expect(polygonArea(polygons[0]) / 100).toBeCloseTo(area, 6);
  });

  it("keeps an elliptical dot's area while stretching it", () => {
    const { sink, ellipses } = recordingSink();
    dotOutline(sink, "ellipse", 0, 0, 10, 0.25, 0.5);
    expect((Math.PI * ellipses[0].major * ellipses[0].minor) / 100).toBeCloseTo(0.25, 6);
    expect(ellipses[0].major).toBeGreaterThan(ellipses[0].minor);
    expect(ellipses[0].angle).toBeCloseTo(0.5, 6);
  });

  it("rotates a polygon into frame space around the dot", () => {
    const { sink, polygons } = recordingSink();
    dotOutline(sink, "square", 100, 50, 10, 1, Math.PI / 4);
    for (const [x, y] of polygons[0]) {
      expect(Math.hypot(x - 100, y - 50)).toBeCloseTo(Math.SQRT2 * 5, 6);
    }
  });

  it("draws a cross as two overlapping bars", () => {
    const { sink, polygons } = recordingSink();
    dotOutline(sink, "cross", 0, 0, 10, 0.19, 0);
    expect(polygons).toHaveLength(2);
    // Two bars of the same thickness, minus the square they share.
    const overlap = (polygonArea(polygons[0]) / 10) ** 2;
    expect((polygonArea(polygons[0]) + polygonArea(polygons[1]) - overlap) / 100)
      .toBeCloseTo(0.19, 6);
  });
});

describe("the lattice walk", () => {
  const settings = (overrides: Partial<typeof defaultSettings.halftone> = {}) => ({
    ...defaultSettings,
    mode: "halftone" as const,
    halftone: halftone(overrides),
  });

  it("prints nothing on white paper and something everywhere on black", () => {
    expect([...screenDots(settings(), flatField(8, 8, 255), 200, 200)]).toHaveLength(0);
    const dark = [...screenDots(settings({ lines: 10 }), flatField(8, 8, 0), 200, 200)];
    expect(dark.length).toBeGreaterThan(90);
    for (const dot of dark) expect(dot.area).toBeCloseTo(1, 3);
  });

  it("covers the frame at the ruling it was given", () => {
    const width = 300;
    const dots = [...screenDots(settings({ lines: 15, angle: 0 }), flatField(4, 4, 0), width, 200)];
    const pitch = screenPitch(width, halftone({ lines: 15 }));
    expect(pitch).toBe(20);
    const inside = dots.filter((dot) => dot.x >= 0 && dot.x <= width && dot.y >= 0 && dot.y <= 200);
    expect(inside).toHaveLength(15 * 10);
  });

  it("walks one lattice per plate, in plate order", () => {
    const dots = [...screenDots(settings({ separation: "cmyk", lines: 12 }), flatField(4, 4, 40), 240, 240)];
    const plates = [...new Set(dots.map((dot) => dot.plate))];
    expect(plates).toEqual([0, 1, 2, 3]);
  });

  it("never asks for a dot larger than the clamp the renderer expects", () => {
    const dots = [...screenDots(settings({ lines: 12, spread: 1.4 }), flatField(4, 4, 0), 240, 240)];
    for (const dot of dots) expect(dot.area).toBeLessThanOrEqual(1.6);
  });
});
