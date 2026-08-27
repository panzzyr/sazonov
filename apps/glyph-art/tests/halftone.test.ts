import { describe, expect, it } from "vitest";
import {
  dotArea,
  latticeRange,
  plateColors,
  plateNames,
  screenAngles,
  separate,
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
      expect(raster).toMatchObject(halftoneSize(settings.halftone.width, width, height));
    }
  });
});
