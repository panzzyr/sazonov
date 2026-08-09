import { describe, expect, it } from "vitest";
import { autoLevels, bandFor, gridSize, lightness, reduceToCells } from "../src/engine/tone";

function checkerboard(width: number, height: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const value = ((index % width) + Math.floor(index / width)) % 2 === 0 ? 255 : 0;
    pixels[index * 4] = value;
    pixels[index * 4 + 1] = value;
    pixels[index * 4 + 2] = value;
    pixels[index * 4 + 3] = 255;
  }
  return pixels;
}

function flat(width: number, height: number, value: number) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  pixels.fill(255);
  for (let index = 0; index < width * height; index += 1) {
    pixels[index * 4] = value;
    pixels[index * 4 + 1] = value;
    pixels[index * 4 + 2] = value;
  }
  return pixels;
}

describe("lightness", () => {
  it("spans black to white", () => {
    expect(lightness(0)).toBeCloseTo(0, 6);
    expect(lightness(1)).toBeCloseTo(1, 6);
  });

  it("puts mid grey near the middle, which linear luminance does not", () => {
    // sRGB 128 is about 0.216 linear; that is L* 53, not L* 22.
    const l = lightness(0.2158);
    expect(l).toBeGreaterThan(0.5);
    expect(l).toBeLessThan(0.56);
  });
});

describe("reducing to cells", () => {
  it("averages in linear light, not in encoded values", () => {
    // A black-and-white checkerboard is half the light, which encodes to 188 —
    // averaging the encoded values instead would wrongly give 128.
    const field = reduceToCells(checkerboard(8, 8), 8, 8, 1, 1);
    expect(field.color[0]).toBeGreaterThanOrEqual(187);
    expect(field.color[0]).toBeLessThanOrEqual(189);
  });

  it("keeps a flat source flat", () => {
    const field = reduceToCells(flat(16, 16, 200), 16, 16, 4, 4);
    for (const value of field.tone) expect(value).toBeCloseTo(field.tone[0], 6);
  });

  it("covers every source pixel exactly once", () => {
    // A gradient's cell average must land between its neighbours' if the box
    // boundaries neither overlap nor leave gaps.
    const width = 12;
    const pixels = new Uint8ClampedArray(width * 4);
    for (let x = 0; x < width; x += 1) {
      const value = Math.round((x / (width - 1)) * 255);
      pixels[x * 4] = value;
      pixels[x * 4 + 1] = value;
      pixels[x * 4 + 2] = value;
      pixels[x * 4 + 3] = 255;
    }
    const field = reduceToCells(pixels, width, 1, 4, 1);
    expect(field.tone[0]).toBeLessThan(field.tone[1]);
    expect(field.tone[1]).toBeLessThan(field.tone[2]);
    expect(field.tone[2]).toBeLessThan(field.tone[3]);
  });

  it("produces one colour triple per cell", () => {
    const field = reduceToCells(flat(8, 8, 64), 8, 8, 2, 2);
    expect(field.tone).toHaveLength(4);
    expect(field.color).toHaveLength(12);
  });
});

describe("auto levels", () => {
  it("stretches a compressed range", () => {
    const tone = Float32Array.from({ length: 100 }, (_, index) => 0.3 + index * 0.004);
    const levels = autoLevels(tone);
    expect(levels.min).toBeGreaterThan(0.29);
    expect(levels.max).toBeLessThan(0.71);
  });

  it("leaves a genuinely flat source alone rather than amplifying noise", () => {
    const tone = Float32Array.from({ length: 100 }, () => 0.5);
    expect(autoLevels(tone)).toEqual({ min: 0, max: 1 });
  });
});

describe("banding", () => {
  const levels = { min: 0, max: 1 };

  it("sends white to the lightest band and black to the darkest", () => {
    expect(bandFor(1, levels, 7, false)).toBe(0);
    expect(bandFor(0, levels, 7, false)).toBe(6);
  });

  it("stays inside the band list at the boundaries", () => {
    for (const tone of [-1, 0, 0.5, 1, 2]) {
      const band = bandFor(tone, levels, 7, false);
      expect(band).toBeGreaterThanOrEqual(0);
      expect(band).toBeLessThan(7);
    }
  });

  it("reverses which band a tone lands on when the ramp is inverted", () => {
    expect(bandFor(1, levels, 7, true)).toBe(6);
    expect(bandFor(0, levels, 7, true)).toBe(0);
  });

  it("applies the levels before quantizing", () => {
    const narrow = { min: 0.4, max: 0.6 };
    expect(bandFor(0.4, narrow, 7, false)).toBe(6);
    expect(bandFor(0.6, narrow, 7, false)).toBe(0);
  });
});

describe("grid geometry", () => {
  it("derives the height from the source aspect", () => {
    expect(gridSize(72, 1600, 1200)).toEqual({ gridW: 72, gridH: 54 });
    expect(gridSize(72, 1080, 1920)).toEqual({ gridW: 72, gridH: 128 });
  });

  it("never collapses to nothing", () => {
    expect(gridSize(8, 4000, 10).gridH).toBe(1);
    expect(gridSize(72, 0, 0)).toEqual({ gridW: 72, gridH: 72 });
  });
});
