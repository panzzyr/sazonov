import type { Point, Segment } from "../export/trace";

export type VectorContour = { start: Point; segments: Segment[] };

/** Only our shipped absolute M/L/Q/C/Z paths enter here, never uploaded SVG. */
export function vectorContours(path: string): VectorContour[] {
  const tokens = path.match(/[MLQCZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const contours: VectorContour[] = [];
  let index = 0;
  let current: Point = [0, 0];
  let contour: VectorContour | undefined;
  const point = (): Point => [Number(tokens[index++]), Number(tokens[index++])];
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") {
      current = point();
      contour = { start: current, segments: [] };
      contours.push(contour);
    } else if (command === "L") {
      current = point();
      contour!.segments.push({ kind: "line", to: current });
    } else if (command === "Q") {
      const control = point();
      const to = point();
      // SVG export already writes cubic curves; this conversion is exact.
      const first: Point = [current[0] + (control[0] - current[0]) * 2 / 3,
        current[1] + (control[1] - current[1]) * 2 / 3];
      const second: Point = [to[0] + (control[0] - to[0]) * 2 / 3,
        to[1] + (control[1] - to[1]) * 2 / 3];
      contour!.segments.push({ kind: "curve", first, second, to });
      current = to;
    } else if (command === "C") {
      const first = point();
      const second = point();
      current = point();
      contour!.segments.push({ kind: "curve", first, second, to: current });
    } else if (command !== "Z") {
      throw new Error("Unsupported shipped vector path.");
    }
  }
  return contours;
}

export function mapContours(contours: VectorContour[], map: (point: Point) => Point): VectorContour[] {
  return contours.map(({ start, segments }) => ({
    start: map(start),
    segments: segments.map((segment): Segment => segment.kind === "line"
      ? { kind: "line", to: map(segment.to) }
      : { kind: "curve", first: map(segment.first), second: map(segment.second), to: map(segment.to) }),
  }));
}

export function contoursPath(contours: VectorContour[], digits = 3) {
  const p = (point: Point) => point.map((v) => Number(v.toFixed(digits))).join(" ");
  return contours.map(({ start, segments }) => `M${p(start)}` + segments.map((segment) =>
    segment.kind === "line" ? `L${p(segment.to)}`
      : `C${p(segment.first)} ${p(segment.second)} ${p(segment.to)}`).join("") + "Z").join("");
}
