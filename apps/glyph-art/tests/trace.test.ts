import { describe, expect, it } from "vitest";
import { simplifyContour, traceContours, type Point } from "../src/export/trace";

const mask = (rows: string[]) => {
  const width = rows[0].length;
  const alpha = new Uint8ClampedArray(width * rows.length);
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    alpha[y * width + x] = cell === "#" ? 255 : cell === "." ? 31 : 0;
  }));
  return { alpha, width, height: rows.length };
};

/** Positive is the winding the walk gives an outer contour. */
const signedArea = (points: Point[]) => points.reduce((sum, [x1, y1], index) => {
  const [x2, y2] = points[(index + 1) % points.length];
  return sum + (x1 * y2 - x2 * y1);
}, 0) / 2;

const trace = (rows: string[]) => {
  const { alpha, width, height } = mask(rows);
  return traceContours(alpha, width, height);
};

describe("contour tracing", () => {
  it("walks a block as one closed loop around its edge", () => {
    const [contour, ...rest] = trace([
      "   ",
      " # ",
      "   ",
    ]);
    expect(rest).toHaveLength(0);
    expect(contour).toEqual([[1, 1], [2, 1], [2, 2], [1, 2]]);
    expect(signedArea(contour)).toBe(1);
  });

  it("winds a hole against its outer contour, so nonzero leaves it open", () => {
    const contours = trace([
      "#####",
      "#   #",
      "#   #",
      "#   #",
      "#####",
    ]);
    const areas = contours.map(signedArea).sort((a, b) => b - a);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toBeGreaterThan(0);
    expect(areas[1]).toBeLessThan(0);
    // The ring's ink, counted the way a nonzero fill counts it.
    expect(areas[0] + areas[1]).toBe(16);
  });

  it("keeps two marks apart as two contours wound the same way", () => {
    const contours = trace([
      "# #",
      "# #",
    ]);
    expect(contours).toHaveLength(2);
    for (const contour of contours) expect(signedArea(contour)).toBe(2);
  });

  it("reads the antialiased fringe as paper, the way the renderer does", () => {
    expect(trace(["..."])).toHaveLength(0);
    expect(trace([".#."])[0]).toEqual([[1, 0], [2, 0], [2, 1], [1, 1]]);
  });
});

describe("contour simplification", () => {
  it("collapses a staircase into the diagonal it was drawing", () => {
    const staircase = trace([
      "#  ",
      "## ",
      "###",
    ])[0];
    expect(staircase.length).toBeGreaterThan(6);
    const simplified = simplifyContour(staircase, 1);
    expect(simplified.length).toBeLessThan(staircase.length);
    expect(signedArea(simplified)).toBeGreaterThan(0);
  });

  it("drops the lattice steps that sit on a straight edge", () => {
    const square = trace(["##", "##"])[0];
    expect(square).toHaveLength(8);
    expect(simplifyContour(square, 0.01)).toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  it("never simplifies a contour away to nothing", () => {
    const square = trace(["#"])[0];
    expect(simplifyContour(square, 100)).toHaveLength(4);
  });

  it("holds the outline within the tolerance it was given", () => {
    const circle: Point[] = [];
    for (let step = 0; step < 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      circle.push([50 + 40 * Math.cos(angle), 50 + 40 * Math.sin(angle)]);
    }
    const coarse = simplifyContour(circle, 2);
    expect(coarse.length).toBeLessThan(circle.length);
    for (const [x, y] of coarse) expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(40, 6);
  });
});
