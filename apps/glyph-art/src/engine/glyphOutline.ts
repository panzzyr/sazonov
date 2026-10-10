import { fitContour, traceIsolines } from "../export/trace.ts";
import { contoursPath, vectorContours, type VectorContour } from "./vector.ts";

/** Tight-box coordinates, shared by Canvas and SVG at every output size. */
export type GlyphOutline = { width: number; height: number; contours: VectorContour[] };
export type PackedOutline = [width: number, height: number, density: number, path: string];

/** Signed area includes holes; sampling is only for tone measurement, not drawing. */
export function outlineDensity(outline: GlyphOutline) {
  let area = 0;
  for (const contour of outline.contours) {
    let at = contour.start;
    const edge = (to: [number, number]) => {
      area += at[0] * to[1] - to[0] * at[1];
      at = to;
    };
    for (const segment of contour.segments) {
      if (segment.kind === "line") edge(segment.to);
      else {
        const from = at;
        for (let i = 1; i <= 24; i++) {
          const t = i / 24, u = 1 - t;
          edge([u ** 3 * from[0] + 3 * u ** 2 * t * segment.first[0]
            + 3 * u * t ** 2 * segment.second[0] + t ** 3 * segment.to[0],
          u ** 3 * from[1] + 3 * u ** 2 * t * segment.first[1]
            + 3 * u * t ** 2 * segment.second[1] + t ** 3 * segment.to[1]]);
        }
      }
    }
    edge(contour.start);
  }
  return Math.max(0, Math.min(1, Math.abs(area) / (2 * outline.width * outline.height)));
}

/** Trace once, at the source's own resolution, never at a frame's printed size. */
export function traceGlyph(alpha: Uint8ClampedArray, width: number, height: number): PackedOutline {
  let maximum = 0;
  for (const value of alpha) maximum = Math.max(maximum, value);
  // Half ink removes a blurred fringe instead of turning it into black hair.
  // Very faint uploads keep their shape rather than becoming an empty outline.
  const threshold = Math.min(128, Math.max(1, Math.round(maximum / 2)));
  const tolerance = Math.max(0.45, Math.min(0.8, Math.max(width, height) / 150));
  const contours = traceIsolines(alpha, width, height, threshold).map(contour => {
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const [x, y] of contour) {
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    // A page-scale tolerance can flatten a one-pixel dot or tiny counter hole
    // into a line. Bound it by the feature's own thickness, not the whole mark.
    return fitContour(contour, Math.min(tolerance, (right - left) / 4, (bottom - top) / 4));
  });
  // Hundredths of a source pixel are well below tracing error; original
  // authored vectors bypass this quantization altogether.
  const path = contoursPath(contours, 2);
  const outline = { width, height, contours: vectorContours(path) };
  return [width, height, outlineDensity(outline), path];
}

export function unpackOutline([width, height, , path]: PackedOutline): GlyphOutline {
  // Expand point arrays only for marks a frame actually uses, not the full pool.
  let contours: VectorContour[] | undefined;
  return { width, height, get contours() { return contours ??= vectorContours(path); } };
}
