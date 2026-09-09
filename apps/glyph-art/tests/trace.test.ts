import { describe, expect, it } from "vitest";
import { fitContour, simplifyIndices, traceContours, type Point, type Segment } from "../src/export/trace";

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

/** Walks a fitted outline, sampling curves finely enough to measure them. */
function walk(start: Point, segments: Segment[]) {
  const points: Point[] = [start];
  let at = start;
  for (const segment of segments) {
    if (segment.kind === "line") {
      points.push(segment.to);
    } else {
      for (let step = 1; step <= 12; step += 1) {
        const t = step / 12;
        const u = 1 - t;
        points.push([
          u * u * u * at[0] + 3 * u * u * t * segment.first[0]
            + 3 * u * t * t * segment.second[0] + t * t * t * segment.to[0],
          u * u * u * at[1] + 3 * u * u * t * segment.first[1]
            + 3 * u * t * t * segment.second[1] + t * t * t * segment.to[1],
        ]);
      }
    }
    at = segment.to;
  }
  return points;
}

function circleMask(radius: number) {
  const size = radius * 2 + 4;
  const alpha = new Uint8ClampedArray(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= radius;
      alpha[y * size + x] = inside ? 255 : 0;
    }
  }
  return { alpha, size };
}

describe("simplification", () => {
  it("collapses a staircase into the diagonal it was drawing", () => {
    const staircase = trace([
      "#  ",
      "## ",
      "###",
    ])[0];
    expect(simplifyIndices(staircase, 1).length).toBeLessThan(staircase.length);
  });

  it("drops the lattice steps that sit on a straight edge", () => {
    const square = trace(["##", "##"])[0];
    expect(square).toHaveLength(8);
    expect(simplifyIndices(square, 0.01).map((index) => square[index]))
      .toEqual([[0, 0], [2, 0], [2, 2], [0, 2]]);
  });

  it("never simplifies a contour away to nothing", () => {
    expect(simplifyIndices(trace(["#"])[0], 100)).toHaveLength(4);
  });
});

describe("curve fitting", () => {
  it("keeps a traced circle round, with a handful of curves", () => {
    const { alpha, size } = circleMask(12);
    const [contour] = traceContours(alpha, size, size);
    const { start, segments } = fitContour(contour, 1);
    expect(segments.length).toBeLessThanOrEqual(6);
    expect(segments.filter((segment) => segment.kind === "curve").length)
      .toBeGreaterThanOrEqual(2);
    // Every sampled point sits on the circle, within the tolerance plus the
    // half pixel the lattice itself cannot resolve.
    for (const [x, y] of walk(start, segments)) {
      expect(Math.abs(Math.hypot(x - size / 2, y - size / 2) - 12)).toBeLessThan(1);
    }
  });

  it("keeps the corners of a punched square, and draws no curve along its sides", () => {
    const rows = Array.from({ length: 24 }, (_, y) => (y < 2 || y > 21
      ? " ".repeat(24)
      : `  ${"#".repeat(20)}  `));
    const [contour] = trace(rows);
    const { start, segments } = fitContour(contour, 0.5);
    expect(segments).toHaveLength(4);
    for (const segment of segments) expect(segment.kind).toBe("line");
    // The walk ends where it started, so the closing point repeats.
    const corners = [...new Set(walk(start, segments).map(([x, y]) => `${x},${y}`))].sort();
    expect(corners).toEqual(["2,2", "2,22", "22,2", "22,22"].sort());
  });

  it("cuts a shape at its corners and rounds only what is round", () => {
    // A half-disc: a straight edge meeting a curve at two sharp corners.
    const radius = 14;
    const size = radius * 2 + 4;
    const alpha = new Uint8ClampedArray(size * size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const inside = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= radius
          && y + 0.5 >= size / 2;
        alpha[y * size + x] = inside ? 255 : 0;
      }
    }
    const [contour] = traceContours(alpha, size, size);
    const { segments } = fitContour(contour, 0.5);
    expect(segments.some((segment) => segment.kind === "line")).toBe(true);
    expect(segments.some((segment) => segment.kind === "curve")).toBe(true);
  });

  it("gives a contour too small to fit a curve to plain lines", () => {
    const { start, segments } = fitContour(trace(["#"])[0], 0.5);
    expect(start).toEqual([0, 0]);
    for (const segment of segments) expect(segment.kind).toBe("line");
  });
});
