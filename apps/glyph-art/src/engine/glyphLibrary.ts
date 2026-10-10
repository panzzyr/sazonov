/**
 * Measuring marks once; drawing the same vectors in every output format.
 *
 * Every mark — shipped, typed or uploaded — goes through the same measurement,
 * and that is deliberate. The ramp solver needs each mark's *ink density*: the
 * fraction of its tight bounding box that is actually inked. Without it a
 * solid square and a thin comma at the same size are the same tone to the code
 * and wildly different tones to the eye, and the tool feels broken in a way
 * nobody can diagnose. With it, any set — letters, doodles, scanned stamps —
 * lands on a sane ramp the moment it is dropped in.
 *
 * A mark's own bounding box is mostly air, so everything is tight-boxed and
 * centred on that box. Predictable beats optically balanced when the user
 * controls the set.
 *
 * Nothing is fetched. Files arrive as data URLs and SVG as markup, both loaded
 * through an `<img>`, which also renders any uploaded SVG inert and leaves its
 * external references blocked by `connect-src 'none'`.
 *
 * Preset scans are vectorized at build time and loaded as trusted, lazy local
 * modules. Their original sprite sheets remain regeneration inputs, not render
 * sources. Loose uploads and text are traced once on insertion. Authored native
 * vectors retain their original curves. Export never traces the rendered frame.
 */

import { fontStacks, type GlyphSpec } from "../types";
import { outlineDensity, traceGlyph, unpackOutline, type GlyphOutline, type PackedOutline } from "./glyphOutline";
import { mapContours, vectorContours } from "./vector";

const packs = import.meta.glob<{ default: PackedOutline[] }>("../preset-vectors/*.ts");

/** Loose marks are measured at this size; drawing uses their prepared curves. */
const raster = 256;

/** Below this an anti-aliased fringe would count as ink and inflate the box. */
const inkFloor = 0.02;

/**
 * Loose marks decoded at once — uploads and the shipped SVGs. Sheets carry the
 * presets, so this only has to keep a folder of uploads from opening a
 * hundred decodes at a stroke.
 */
const concurrency = 8;

export type MarkBox = { x: number; y: number; width: number; height: number };

export type MeasuredGlyph = {
  spec: GlyphSpec;
  /** Ink fraction of the tight box, 0..1. */
  density: number;
  /** Tight box width over height. */
  aspect: number;
  /**
   * Optional measurement mask, not render artwork. Presets have no bitmap.
   */
  bitmap?: HTMLCanvasElement;
  /** Tight coordinate frame; also locates a legacy measurement mask. */
  box: MarkBox;
  /** Original vector coordinates to the loose mask's cropped pixel frame. */
  vectorTransform?: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
  /** Prepared once, independent of printed size and animation frame. */
  outline?: GlyphOutline;
};

const outlines = new WeakMap<MeasuredGlyph, GlyphOutline>();
const paths = new WeakMap<GlyphOutline, Path2D>();

/** Legacy/in-memory callers also prepare an outline once, never per export size. */
export function glyphOutline(glyph: MeasuredGlyph): GlyphOutline {
  if (glyph.outline) return glyph.outline;
  const hit = outlines.get(glyph);
  if (hit) return hit;
  const { box, spec } = glyph;
  let outline: GlyphOutline;
  if (spec.vector) {
    const transform = glyph.vectorTransform ?? {
      scaleX: (glyph.bitmap?.width ?? box.width) / spec.vector.width,
      scaleY: (glyph.bitmap?.height ?? box.height) / spec.vector.height,
      offsetX: -box.x, offsetY: -box.y,
    };
    outline = { width: box.width, height: box.height,
      contours: mapContours(vectorContours(spec.vector.path), ([x, y]) => [
        x * transform.scaleX + transform.offsetX, y * transform.scaleY + transform.offsetY,
      ]) };
  } else {
    const context = glyph.bitmap?.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("This mark has no prepared vector outline.");
    const pixels = context.getImageData(box.x, box.y, box.width, box.height).data;
    const alpha = new Uint8ClampedArray(box.width * box.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3];
    outline = unpackOutline(traceGlyph(alpha, box.width, box.height));
  }
  outlines.set(glyph, outline);
  return outline;
}

/** Draws a mark's tight box into a rectangle — the one way a mark is drawn. */
export function drawGlyph(
  context: CanvasRenderingContext2D,
  glyph: MeasuredGlyph,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const outline = glyphOutline(glyph);
  let path = paths.get(outline);
  if (!path) {
    path = new Path2D();
    for (const contour of outline.contours) {
      path.moveTo(...contour.start);
      for (const segment of contour.segments) {
        if (segment.kind === "line") path.lineTo(...segment.to);
        else path.bezierCurveTo(...segment.first, ...segment.second, ...segment.to);
      }
      path.closePath();
    }
    paths.set(outline, path);
  }
  context.save();
  context.translate(x, y);
  context.scale(width / outline.width, height / outline.height);
  context.fillStyle = "#000";
  context.fill(path, "nonzero");
  context.restore();
}

function makeCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener(
      "error",
      () => reject(new Error("That file could not be read as an image.")),
      { once: true },
    );
    image.src = source;
  });
}

function svgUrl(markup: string) {
  // An SVG with only a viewBox has no intrinsic size in an <img>, so the box
  // is stated explicitly before handing it to the decoder.
  const sized = /\swidth=/.test(markup)
    ? markup
    : markup.replace(/<svg\b/, `<svg width="${raster}" height="${raster}"`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
}

/** Draws a loose mark at raster scale on transparency, whatever its origin. */
async function rasterize(spec: GlyphSpec): Promise<HTMLCanvasElement> {
  if (spec.kind === "text") {
    return rasterizeText(spec);
  }

  const source = spec.kind === "mark"
    ? svgUrl(spec.source)
    : spec.kind === "preset"
      ? `${import.meta.env.BASE_URL}${spec.source}`
      : spec.source;
  const image = await loadImage(source);
  const naturalWidth = image.naturalWidth || raster;
  const naturalHeight = image.naturalHeight || raster;
  const scale = raster / Math.max(naturalWidth, naturalHeight);
  const canvas = makeCanvas(naturalWidth * scale, naturalHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function rasterizeText(spec: GlyphSpec): HTMLCanvasElement {
  const stack = fontStacks.find((entry) => entry.id === spec.font)?.stack ?? fontStacks[0].stack;
  const probe = makeCanvas(raster * 2, raster * 2).getContext("2d");
  if (!probe) throw new Error("This browser did not give us a 2D canvas.");

  const size = raster;
  probe.font = `${size}px ${stack}`;
  probe.textBaseline = "alphabetic";
  const metrics = probe.measureText(spec.source);
  const left = metrics.actualBoundingBoxLeft ?? 0;
  const right = metrics.actualBoundingBoxRight ?? metrics.width;
  const ascent = metrics.actualBoundingBoxAscent ?? size * 0.8;
  const descent = metrics.actualBoundingBoxDescent ?? size * 0.2;

  // A pixel of slack keeps the anti-aliased edge from being clipped, which
  // would bias the density measurement upward.
  const width = Math.max(1, right + left) + 2;
  const height = Math.max(1, ascent + descent) + 2;
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  context.font = `${size}px ${stack}`;
  context.textBaseline = "alphabetic";
  context.fillStyle = "#000";
  context.fillText(spec.source, left + 1, ascent + 1);
  return canvas;
}

/**
 * The tight box of the ink inside a region, and its density.
 *
 * `ink` is one value per pixel in rows of `stride`, where `full` is solid ink:
 * 1 for a float field, 255 for bytes off a sheet. Shared by both kinds of mark,
 * so a loose one and a sheet one are boxed and measured by the same rule.
 */
function inkBox(ink: ArrayLike<number>, stride: number, full: number, region: MarkBox) {
  const floor = inkFloor * full;
  let left = Infinity;
  let right = -1;
  let top = Infinity;
  let bottom = -1;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    for (let x = region.x; x < region.x + region.width; x += 1) {
      if (ink[y * stride + x] <= floor) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return undefined;

  const width = right - left + 1;
  const height = bottom - top + 1;
  let sum = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) sum += ink[y * stride + x];
  }
  return { x: left, y: top, width, height, density: sum / full / (width * height) };
}

type Measured = Omit<MeasuredGlyph, "spec">;

function blank(bitmap = makeCanvas(1, 1), at: MarkBox = { x: 0, y: 0, width: 1, height: 1 }): Measured {
  return { density: 0, aspect: 1, bitmap, box: { ...at, width: 1, height: 1 },
    outline: { width: 1, height: 1, contours: [] } };
}

/**
 * Measures a loose mark's ink and returns it as a tight-boxed mask.
 *
 * Ink is `alpha × (1 − luma)`, which is right for the two shapes real files
 * arrive in: an opaque white JPEG background contributes nothing, and a
 * black-on-transparent PNG measures its alpha. A file drawn in white on
 * transparency would measure as empty under that rule, so it falls back to
 * alpha alone rather than silently disappearing.
 */
function measure(canvas: HTMLCanvasElement, vector?: GlyphSpec["vector"]): Measured {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  const { width, height } = canvas;
  const pixels = context.getImageData(0, 0, width, height).data;

  const ink = new Float32Array(width * height);
  let inkTotal = 0;
  let alphaTotal = 0;

  for (let index = 0; index < ink.length; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3] / 255;
    const luma = (0.2126 * pixels[offset] + 0.7152 * pixels[offset + 1] + 0.0722 * pixels[offset + 2]) / 255;
    ink[index] = alpha * (1 - luma);
    inkTotal += ink[index];
    alphaTotal += alpha;
  }

  if (inkTotal < alphaTotal * 0.02 && alphaTotal > 0) {
    for (let index = 0; index < ink.length; index += 1) {
      ink[index] = pixels[index * 4 + 3] / 255;
    }
  }

  const box = inkBox(ink, width, 1, { x: 0, y: 0, width, height });
  if (!box) return blank();

  const mask = makeCanvas(box.width, box.height);
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("This browser did not give us a 2D canvas.");
  const output = maskContext.createImageData(box.width, box.height);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      output.data[(y * box.width + x) * 4 + 3] = Math.round(ink[(y + box.y) * width + (x + box.x)] * 255);
    }
  }
  maskContext.putImageData(output, 0, 0);

  const transform = vector ? {
    scaleX: width / vector.width, scaleY: height / vector.height,
    offsetX: -box.x, offsetY: -box.y,
  } : undefined;
  const alpha = new Uint8ClampedArray(box.width * box.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = output.data[i * 4 + 3];
  const outline: GlyphOutline = vector ? {
    width: box.width, height: box.height,
    contours: mapContours(vectorContours(vector.path), ([x, y]) => [
      x * transform!.scaleX + transform!.offsetX, y * transform!.scaleY + transform!.offsetY,
    ]),
  } : unpackOutline(traceGlyph(alpha, box.width, box.height));
  return {
    density: vector ? box.density : outlineDensity(outline),
    aspect: box.width / box.height,
    bitmap: mask,
    box: { x: 0, y: 0, width: box.width, height: box.height },
    outline,
    ...(transform ? { vectorTransform: transform } : {}),
  };
}

/**
 * Measured marks, keyed by id. The renderer asks for an outline every cell, so
 * lookups are synchronous; loading happens once, up front, in `ensure`.
 */
export class GlyphLibrary {
  private generation = 0;
  private entries = new Map<string, MeasuredGlyph>();
  private signatures = new Map<string, string>();

  get(id: string) {
    return this.entries.get(id);
  }

  has(id: string) {
    return this.entries.has(id);
  }

  /** Density and aspect only — what the ramp solver needs. */
  metrics = (id: string) => {
    const entry = this.entries.get(id);
    return entry ? { density: entry.density, aspect: entry.aspect } : undefined;
  };

  /**
   * Loads anything new or changed, and forgets marks no longer in the set.
   *
   * Preset marks arrive as lazy local vector modules, one per selected group.
   * Parsing yields in small batches so cancellation and progress stay responsive.
   * Loose marks — uploads, typed characters, the shipped SVGs — load a few at
   * a time, because a folder of uploads one after another is a long wait.
   *
   * The measuring stays on the main thread and stays in one place, so the
   * order marks finish in cannot change what any of them measures.
   */
  async ensure(specs: GlyphSpec[], onProgress?: (loaded: number, total: number) => void) {
    const generation = ++this.generation;
    const wanted = new Set(specs.map((spec) => spec.id));
    for (const id of [...this.entries.keys()]) {
      if (!wanted.has(id)) {
        this.entries.delete(id);
        this.signatures.delete(id);
      }
    }
    const pending = specs
      .map((spec) => ({
        spec,
        signature: `${spec.kind}:${spec.font ?? ""}:${spec.source}:${spec.rect?.join(",") ?? ""}:${spec.vectorPack?.join(":") ?? ""}:${spec.vector?.path ?? ""}`,
      }))
      .filter(({ spec, signature }) => this.signatures.get(spec.id) !== signature);
    if (pending.length === 0) return;

    let done = 0;
    const settle = (spec: GlyphSpec, signature: string, measured: Measured) => {
      if (generation !== this.generation) return;
      this.entries.set(spec.id, { spec, ...measured });
      this.signatures.set(spec.id, signature);
      done += 1;
      onProgress?.(done, pending.length);
    };

    const byPack = new Map<string, typeof pending>();
    const loose: typeof pending = [];
    for (const entry of pending) {
      if (!entry.spec.vectorPack) {
        loose.push(entry);
        continue;
      }
      const key = entry.spec.vectorPack[0];
      const group = byPack.get(key);
      if (group) group.push(entry);
      else byPack.set(key, [entry]);
    }

    const packWork = [...byPack].map(async ([key, group]) => {
      const load = packs[`../preset-vectors/${key}.ts`];
      if (!load) throw new Error(`Missing shipped vector group: ${key}.`);
      const { default: packed } = await load();
      for (const [index, { spec, signature }] of group.entries()) {
        if (generation !== this.generation) return;
        const data = packed[spec.vectorPack![1]];
        if (!data) throw new Error(`Missing shipped vector: ${spec.id}.`);
        const [width, height, density] = data;
        settle(spec, signature, { density, aspect: width / height,
          box: { x: 0, y: 0, width, height }, outline: unpackOutline(data) });
        if (index % 64 === 63) await new Promise(resolve => setTimeout(resolve, 0));
      }
    });

    let next = 0;
    const worker = async () => {
      for (;;) {
        if (generation !== this.generation) return;
        const index = next;
        next += 1;
        if (index >= loose.length) return;
        const { spec, signature } = loose[index];
        settle(spec, signature, measure(await rasterize(spec), spec.vector));
      }
    };

    await Promise.all([
      ...packWork,
      ...Array.from({ length: Math.min(concurrency, loose.length) }, worker),
    ]);
  }
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)), { once: true });
    reader.addEventListener("error", () => reject(new Error(`${file.name} could not be read.`)), { once: true });
    reader.readAsDataURL(file);
  });
}
