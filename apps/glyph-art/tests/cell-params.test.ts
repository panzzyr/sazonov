import { describe, expect, it } from "vitest";
import { cycleIndex, handDraw, loopLength } from "../src/engine/cellParams";

describe("hand", () => {
  it("does nothing at zero", () => {
    expect(handDraw(8471, 42, 0)).toEqual({ rotation: 0, offsetX: 0, offsetY: 0, sizeScale: 1 });
  });

  it("is stable across frames, so the surface does not boil", () => {
    // There is no frame argument at all — that is the guarantee, stated as a
    // test so nobody adds one later without noticing what it would cost.
    expect(handDraw(8471, 42, 0.5)).toEqual(handDraw(8471, 42, 0.5));
  });

  it("differs between neighbouring cells", () => {
    expect(handDraw(8471, 42, 0.5).rotation).not.toBe(handDraw(8471, 43, 0.5).rotation);
  });

  it("follows the seed", () => {
    expect(handDraw(1, 42, 0.5).rotation).not.toBe(handDraw(2, 42, 0.5).rotation);
  });

  it("stays inside its stated bounds", () => {
    for (let cell = 0; cell < 500; cell += 1) {
      const draw = handDraw(8471, cell, 1);
      expect(Math.abs(draw.rotation)).toBeLessThanOrEqual((12 * Math.PI) / 180);
      expect(Math.abs(draw.offsetX)).toBeLessThanOrEqual(0.06);
      expect(Math.abs(draw.offsetY)).toBeLessThanOrEqual(0.06);
      expect(draw.sizeScale).toBeGreaterThanOrEqual(0.92);
      expect(draw.sizeScale).toBeLessThanOrEqual(1.08);
    }
  });

  it("scales with the knob", () => {
    expect(Math.abs(handDraw(8471, 42, 0.25).rotation))
      .toBeLessThan(Math.abs(handDraw(8471, 42, 1).rotation));
  });
});

describe("cycling", () => {
  it("stays put when a band holds one mark", () => {
    for (let frame = 0; frame < 20; frame += 1) {
      expect(cycleIndex(8471, 3, 1, frame, 2)).toBe(0);
    }
  });

  it("advances once every hold frames", () => {
    const at = (frame: number) => cycleIndex(8471, 3, 3, frame, 4);
    expect(at(0)).toBe(at(3));
    expect(at(0)).not.toBe(at(4));
  });

  it("returns to the start after a full cycle", () => {
    expect(cycleIndex(8471, 3, 3, 0, 2)).toBe(cycleIndex(8471, 3, 3, 6, 2));
  });

  it("puts neighbouring cells out of phase, so the image simmers", () => {
    const phases = new Set<number>();
    for (let cell = 0; cell < 40; cell += 1) phases.add(cycleIndex(8471, cell, 3, 0, 2));
    expect(phases.size).toBeGreaterThan(1);
  });

  it("only ever names a mark that exists", () => {
    for (let cell = 0; cell < 200; cell += 1) {
      for (const pool of [2, 3, 5]) {
        const index = cycleIndex(8471, cell, pool, cell, 2);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(pool);
      }
    }
  });
});

describe("seamless loop length", () => {
  it("is one frame when nothing cycles", () => {
    expect(loopLength([1, 1, 1], 2)).toBe(1);
    expect(loopLength([1], 1)).toBe(1);
  });

  it("is the common multiple of the pools, times the hold", () => {
    expect(loopLength([2, 3], 1)).toBe(6);
    expect(loopLength([2, 3], 2)).toBe(12);
    expect(loopLength([4, 6], 1)).toBe(12);
  });

  it("stays inside the export cap", () => {
    expect(loopLength([7, 11, 13, 17, 19], 24)).toBeLessThanOrEqual(900);
  });
});
