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
 * Douglas–Peucker on a closed contour.
 *
 * The loop is cut at the point furthest from its start before simplifying, so
 * the two ends of the run are real corners of the shape. Cutting anywhere else
 * pins an arbitrary lattice step in place and lets the segment it belongs to
 * survive the whole simplification.
 */
export function simplifyContour(points: Point[], tolerance: number): Point[] {
  if (points.length < 4 || tolerance <= 0) return points;

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

  // The far half wraps past the end, so it is simplified as its own run that
  // closes on the first point; nothing pins the last lattice step in place.
  const tail = [...points.slice(furthest), points[0]];
  const tailKeep = tail.map(() => false);
  simplifyRun(tail, tolerance, 0, tail.length - 1, tailKeep);
  for (let index = 1; index < tail.length - 1; index += 1) {
    if (tailKeep[index]) keep[furthest + index] = true;
  }

  const simplified = points.filter((_, index) => keep[index]);
  return simplified.length >= 3 ? simplified : points;
}
