/**
 * Turning a measured mask into an outline.
 *
 * A mark is a bitmap — a scan, a typed character, an uploaded file — measured
 * into an alpha mask, and the honest vector of one is its contour. The
 * question is what shape that contour takes, and the answer decides whether
 * the export can be opened at all.
 *
 * Merged pixel runs are the easy answer and the wrong one. A mask is 256 px
 * across, so a run-traced mark is hundreds of little rectangles; that is cheap
 * only while every impression of the mark can *share* one definition. Sharing
 * means `<symbol>` and `<use>`, and that is exactly what a drawing program
 * will not take — so the geometry has to be written out once per impression,
 * and then rectangles are megabytes.
 *
 * So: marching squares over the mask's own lattice, then Douglas–Peucker at a
 * tolerance set by how large the mark actually prints. A staircase of pixel
 * steps collapses into the few segments that were visible in it, which is both
 * a fraction of the size and the outline someone would want to edit.
 *
 * Winding matters and is not decorative. Marks overlap — the union in alpha is
 * what makes ink over ink still ink — so every impression ends up in one path
 * and is filled `nonzero`. Outer contours are wound one way and holes the
 * other, which is what the walk below produces; `evenodd` would look right
 * until two marks touched and then punch a hole between them.
 */

export type Point = [number, number];

/** Alpha at or above this is ink. Below it is the antialiased fringe. */
export const inkThreshold = 32;

/**
 * Closed contours around the ink, in mask pixels.
 *
 * Each pixel is the unit square from its own corner, and a boundary edge is
 * walked with the ink on its left: outer contours come back clockwise and
 * holes counter-clockwise, so a `nonzero` fill keeps the holes open and lets
 * overlapping marks merge.
 */
export function traceContours(alpha: Uint8ClampedArray, width: number, height: number) {
  const ink = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && alpha[y * width + x] >= inkThreshold;

  // Every boundary edge, keyed by where it starts. A lattice corner can carry
  // two of them where two contours touch diagonally; either continuation
  // closes a loop, so which one is taken does not matter.
  const edges = new Map<number, Point[]>();
  const key = (x: number, y: number) => y * (width + 1) + x;
  const add = (fromX: number, fromY: number, to: Point) => {
    const at = key(fromX, fromY);
    const list = edges.get(at);
    if (list) list.push(to);
    else edges.set(at, [to]);
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!ink(x, y)) continue;
      if (!ink(x, y - 1)) add(x, y, [x + 1, y]);
      if (!ink(x + 1, y)) add(x + 1, y, [x + 1, y + 1]);
      if (!ink(x, y + 1)) add(x + 1, y + 1, [x, y + 1]);
      if (!ink(x - 1, y)) add(x, y + 1, [x, y]);
    }
  }

  const take = (at: number) => {
    const list = edges.get(at);
    if (!list || list.length === 0) return undefined;
    const next = list.pop() as Point;
    if (list.length === 0) edges.delete(at);
    return next;
  };

  const contours: Point[][] = [];
  for (const start of [...edges.keys()]) {
    const startX = start % (width + 1);
    const startY = Math.floor(start / (width + 1));
    for (let step = take(start); step; step = take(start)) {
      const contour: Point[] = [[startX, startY]];
      let current = step;
      while (current[0] !== startX || current[1] !== startY) {
        contour.push(current);
        const next = take(key(current[0], current[1]));
        if (!next) break;
        current = next;
      }
      contours.push(contour);
    }
  }

  return contours;
}

/** Perpendicular distance from a point to the line through two others. */
function deviation(point: Point, from: Point, to: Point) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return Math.hypot(point[0] - from[0], point[1] - from[1]);
  return Math.abs(dy * (point[0] - from[0]) - dx * (point[1] - from[1])) / length;
}

/** Douglas–Peucker over an open run of points. */
function simplifyRun(points: Point[], tolerance: number, from: number, to: number, keep: boolean[]) {
  let worst = 0;
  let at = -1;
  for (let index = from + 1; index < to; index += 1) {
    const distance = deviation(points[index], points[from], points[to]);
    if (distance > worst) {
      worst = distance;
      at = index;
    }
  }
  if (at < 0 || worst <= tolerance) return;
  keep[at] = true;
  simplifyRun(points, tolerance, from, at, keep);
  simplifyRun(points, tolerance, at, to, keep);
}

/**
 * Douglas–Peucker over a closed contour, reporting the indices it keeps.
 *
 * The loop is cut at the point furthest from its start before simplifying, so
 * the two ends of the run are real corners of the shape. Cutting anywhere else
 * pins an arbitrary lattice step in place and lets the segment it belongs to
 * survive the whole simplification.
 */
export function simplifyIndices(points: Point[], tolerance: number): number[] {
  const all = points.map((_, index) => index);
  if (points.length < 4 || tolerance <= 0) return all;

  let furthest = 0;
  let span = -1;
  for (let index = 1; index < points.length; index += 1) {
    const distance = Math.hypot(points[index][0] - points[0][0], points[index][1] - points[0][1]);
    if (distance > span) {
      span = distance;
      furthest = index;
    }
  }

  const keep = points.map(() => false);
  keep[0] = true;
  keep[furthest] = true;
  simplifyRun(points, tolerance, 0, furthest, keep);

  const tail = [...points.slice(furthest), points[0]];
  const tailKeep = tail.map(() => false);
  simplifyRun(tail, tolerance, 0, tail.length - 1, tailKeep);
  for (let index = 1; index < tail.length - 1; index += 1) {
    if (tailKeep[index]) keep[furthest + index] = true;
  }

  const kept = all.filter((index) => keep[index]);
  return kept.length >= 3 ? kept : all;
}

export type Segment =
  | { kind: "line"; to: Point }
  | { kind: "curve"; first: Point; second: Point; to: Point };

/** A turn sharper than this is a corner of the shape, not a step of the lattice. */
const cornerAngle = Math.cos((55 * Math.PI) / 180);

/**
 * How far the staircase is smoothed away before the corners are looked for.
 *
 * In lattice pixels, and it has to be about one: between neighbours every step
 * of a traced contour is a right angle, so asking a raw contour where it turns
 * a corner answers "everywhere" — which is how a circle came out an octagon.
 * Simplify first, ask second, and then fit the curve back to the real points.
 */
const cornerSmoothing = 0.9;

/**
 * How long the straight stretches either side of a corner have to be.
 *
 * A corner is where two edges meet, so both edges have to exist. Without this
 * the last step before a circle's flattest point counts as an edge, meets the
 * flat at a right angle, and puts a corner where the shape has none.
 */
const cornerRun = 2.5;

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]];
}

function normalise(point: Point): Point {
  const length = Math.hypot(point[0], point[1]);
  return length < 1e-9 ? [0, 0] : [point[0] / length, point[1] / length];
}

/**
 * Where the outline actually turns a corner, as indices into the raw contour.
 *
 * A vertex of the simplified outline is a place where the shape genuinely
 * changes direction; how sharply it turns there decides whether it is a corner
 * to keep or a bend to draw through.
 */
function findCorners(points: Point[]) {
  const kept = simplifyIndices(points, cornerSmoothing);
  if (kept.length < 3) return [];

  const corners: number[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const at = points[kept[index]];
    const before = subtract(at, points[kept[(index - 1 + kept.length) % kept.length]]);
    const after = subtract(points[kept[(index + 1) % kept.length]], at);
    if (Math.hypot(before[0], before[1]) < cornerRun) continue;
    if (Math.hypot(after[0], after[1]) < cornerRun) continue;
    const back = normalise(before);
    const ahead = normalise(after);
    if (back[0] * ahead[0] + back[1] * ahead[1] <= cornerAngle) corners.push(kept[index]);
  }
  return corners;
}

/** The greatest distance from the run to the straight line across it. */
function straightness(points: Point[], from: number, to: number) {
  let worst = 0;
  for (let index = from + 1; index < to; index += 1) {
    const distance = deviation(points[index], points[from], points[to]);
    if (distance > worst) worst = distance;
  }
  return worst;
}

function bezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

/**
 * Least-squares cubic through a run, with the tangents it arrives and leaves on.
 *
 * Schneider's fit: the two control points sit along the given tangents, and how
 * far along is solved from the chord-length parameterisation of the points. It
 * is the standard way to put a curve through a traced outline, and it is what
 * keeps a circle a circle instead of the polygon a tolerance would leave.
 */
function fitCubic(points: Point[], from: number, to: number, start: Point, end: Point) {
  const first = points[from];
  const last = points[to];
  const span = to - from;
  if (span === 1) return null;

  const parameters: number[] = [0];
  let total = 0;
  for (let index = from + 1; index <= to; index += 1) {
    total += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
    );
    parameters.push(total);
  }
  if (total < 1e-9) return null;
  for (let index = 0; index < parameters.length; index += 1) parameters[index] /= total;

  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let index = 0; index <= span; index += 1) {
    const t = parameters[index];
    const u = 1 - t;
    const a0: Point = [start[0] * 3 * u * u * t, start[1] * 3 * u * u * t];
    const a1: Point = [end[0] * 3 * u * t * t, end[1] * 3 * u * t * t];
    c00 += a0[0] * a0[0] + a0[1] * a0[1];
    c01 += a0[0] * a1[0] + a0[1] * a1[1];
    c11 += a1[0] * a1[0] + a1[1] * a1[1];
    const target: Point = [
      points[from + index][0] - (u * u * u * first[0] + 3 * u * u * t * first[0]
        + 3 * u * t * t * last[0] + t * t * t * last[0]),
      points[from + index][1] - (u * u * u * first[1] + 3 * u * u * t * first[1]
        + 3 * u * t * t * last[1] + t * t * t * last[1]),
    ];
    x0 += a0[0] * target[0] + a0[1] * target[1];
    x1 += a1[0] * target[0] + a1[1] * target[1];
  }

  const determinant = c00 * c11 - c01 * c01;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let alpha0 = Math.abs(determinant) < 1e-12 ? chord / 3 : (x0 * c11 - c01 * x1) / determinant;
  let alpha1 = Math.abs(determinant) < 1e-12 ? chord / 3 : (c00 * x1 - x0 * c01) / determinant;
  if (alpha0 < 1e-6 || alpha1 < 1e-6) {
    alpha0 = chord / 3;
    alpha1 = chord / 3;
  }

  const control0: Point = [first[0] + start[0] * alpha0, first[1] + start[1] * alpha0];
  const control1: Point = [last[0] + end[0] * alpha1, last[1] + end[1] * alpha1];

  let worst = 0;
  let split = from + Math.floor(span / 2);
  for (let index = 1; index < span; index += 1) {
    const at = bezier(first, control0, control1, last, parameters[index]);
    const distance = Math.hypot(at[0] - points[from + index][0], at[1] - points[from + index][1]);
    if (distance > worst) {
      worst = distance;
      split = from + index;
    }
  }

  return { control0, control1, worst, split };
}

/** The direction the outline is heading, averaged over a few points. */
function tangent(points: Point[], at: number, towards: number) {
  const step = Math.sign(towards - at) || 1;
  const reach = Math.max(1, Math.min(5, Math.abs(towards - at)));
  return normalise(subtract(points[at + step * reach], points[at]));
}

/** The corners a Douglas-Peucker walk would keep across an open run. */
function polylineIndices(points: Point[], from: number, to: number, tolerance: number) {
  const keep = points.map(() => false);
  keep[from] = true;
  keep[to] = true;
  simplifyRun(points, tolerance, from, to, keep);
  const kept: number[] = [];
  for (let index = from; index <= to; index += 1) if (keep[index]) kept.push(index);
  return kept;
}

function fitRun(
  points: Point[],
  from: number,
  to: number,
  tolerance: number,
  out: Segment[],
  whole = true,
) {
  if (to - from < 1) return;
  if (to - from < 3 || straightness(points, from, to) <= tolerance) {
    out.push({ kind: "line", to: points[to] });
    return;
  }

  // A curve costs three points to a line's one, so it has to be doing work a
  // line cannot. A stretch of scanned edge that is really a corner or two is
  // cheaper and more honest as lines.
  // Once a curve has been split for accuracy, its halves carry on as curves:
  // asking again there is how a circle ends up a polygon, one half at a time.
  if (whole) {
    const corners = polylineIndices(points, from, to, tolerance);
    if (corners.length <= 3) {
      for (let index = 1; index < corners.length; index += 1) {
        out.push({ kind: "line", to: points[corners[index]] });
      }
      return;
    }
  }

  const fit = fitCubic(points, from, to, tangent(points, from, to), tangent(points, to, from));
  if (fit && fit.worst <= tolerance) {
    out.push({ kind: "curve", first: fit.control0, second: fit.control1, to: points[to] });
    return;
  }

  const split = fit && fit.split > from && fit.split < to ? fit.split : from + Math.floor((to - from) / 2);
  fitRun(points, from, split, tolerance, out, false);
  fitRun(points, split, to, tolerance, out, false);
}

/**
 * The staircase eased off a run, with its ends left where they were.
 *
 * A traced contour steps a whole pixel at a time, so it wobbles half a pixel
 * either side of the edge it is describing. Fitting a curve to those points
 * measures the wobble as error and splits the run to chase it — a circle comes
 * back as eight little curves. Averaging along the run puts the points back on
 * the middle of the staircase, which is where the edge actually was. The ends
 * are corners, or the tangents of the neighbouring run, so they stay put.
 */
function easeRun(points: Point[]): Point[] {
  if (points.length < 5) return points;
  const eased = points.map((point) => [...point] as Point);
  for (let index = 1; index < points.length - 1; index += 1) {
    const back = points[Math.max(0, index - 2)];
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    const ahead = points[Math.min(points.length - 1, index + 2)];
    eased[index] = [
      (back[0] + 2 * previous[0] + 3 * point[0] + 2 * next[0] + ahead[0]) / 9,
      (back[1] + 2 * previous[1] + 3 * point[1] + 2 * next[1] + ahead[1]) / 9,
    ];
  }
  return eased;
}

/**
 * A closed outline as lines and curves, within `tolerance` of the traced points.
 *
 * Corners are found first and the runs between them are fitted on their own, so
 * the outline is smooth where the mark is smooth and sharp where the mark has a
 * corner — a punched square keeps its four right angles while a stamped dot
 * stays round. A polygon can only have one of those at a time, and paying for
 * the round one in points is what made the files heavy.
 */
export function fitContour(points: Point[], tolerance: number) {
  const segments: Segment[] = [];
  if (points.length < 3) return { start: points[0], segments };

  const corners = findCorners(points);
  // With no corner anywhere the loop is cut in two, because a run has to start
  // and end somewhere and a single point cannot carry both tangents.
  const cuts = corners.length > 0
    ? corners
    : [0, Math.floor(points.length / 2)];

  const start = points[cuts[0]];
  for (let index = 0; index < cuts.length; index += 1) {
    const from = cuts[index];
    const to = cuts[(index + 1) % cuts.length];
    const run = to > from
      ? points.slice(from, to + 1)
      : [...points.slice(from), ...points.slice(0, to + 1)];
    const eased = easeRun(run);
    fitRun(eased, 0, eased.length - 1, tolerance, segments);
  }

  return { start, segments };
}
