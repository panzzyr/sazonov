/**
 * Rasterizing and measuring marks.
 *
 * Every mark — shipped, typed or uploaded — goes through the same path, and
 * that is deliberate. The ramp solver needs each mark's *ink density*: the
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
 * Shipped preset marks are the one thing that comes off the network, and they
 * come off it as images: a relative path under the site's own base, loaded
 * through the same `<img>` and covered by `img-src 'self'`. They are prepared
 * so that this measurement returns exactly the density the build script
 * measured — see `scripts/build-glyph-presets.mjs` and `tests/presets.test.ts`.
 */

import { fontStacks, type GlyphSpec } from "../types";

/** Marks are measured and cached at this size, then scaled down when drawn. */
const raster = 256;

/** Below this an anti-aliased fringe would count as ink and inflate the box. */
const inkFloor = 0.02;

/**
 * Marks decoded at once. High enough that a large preset arrives in seconds,
 * low enough not to open a hundred connections at a stroke.
 */
const concurrency = 8;

export type MeasuredGlyph = {
  spec: GlyphSpec;
  /** Ink fraction of the tight box, 0..1. */
  density: number;
  /** Tight box width over height. */
  aspect: number;
  /** Tight-boxed ink mask: black, with alpha carrying the ink. */
  bitmap: HTMLCanvasElement;
};

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

/** Draws a mark at raster scale on transparency, whatever its origin. */
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
 * Measures ink and returns a tight-boxed mask.
 *
 * Ink is `alpha × (1 − luma)`, which is right for the two shapes real files
 * arrive in: an opaque white JPEG background contributes nothing, and a
 * black-on-transparent PNG measures its alpha. A file drawn in white on
 * transparency would measure as empty under that rule, so it falls back to
 * alpha alone rather than silently disappearing.
 */
function measure(canvas: HTMLCanvasElement) {
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

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ink[y * width + x] <= inkFloor) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < left || bottom < top) {
    return { density: 0, aspect: 1, bitmap: makeCanvas(1, 1) };
  }

  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const mask = makeCanvas(boxWidth, boxHeight);
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("This browser did not give us a 2D canvas.");
  const output = maskContext.createImageData(boxWidth, boxHeight);

  let sum = 0;
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      const value = ink[(y + top) * width + (x + left)];
      sum += value;
      output.data[(y * boxWidth + x) * 4 + 3] = Math.round(value * 255);
    }
  }
  maskContext.putImageData(output, 0, 0);

  return {
    density: sum / (boxWidth * boxHeight),
    aspect: boxWidth / boxHeight,
    bitmap: mask,
  };
}

/**
 * Measured marks, keyed by id. The renderer asks it for a mask every cell, so
 * lookups are synchronous; loading happens once, up front, in `ensure`.
 */
export class GlyphLibrary {
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
   * Loading runs several marks at a time. That is not a micro-optimisation: a
   * preset cut from newspaper pages carries a hundred and twenty-five marks,
   * each a separate request, and loading them one after another means a
   * hundred and twenty-five round trips end to end. On a real connection that
   * is half a minute of a blank ramp — the tool looks broken rather than busy.
   * A handful in flight at once turns the same work into a few seconds.
   *
   * The measuring stays on the main thread and stays in one place, so the
   * order marks finish in cannot change what any of them measures.
   */
  async ensure(specs: GlyphSpec[], onProgress?: (loaded: number, total: number) => void) {
    const wanted = new Set(specs.map((spec) => spec.id));
    for (const id of [...this.entries.keys()]) {
      if (!wanted.has(id)) {
        this.entries.delete(id);
        this.signatures.delete(id);
      }
    }

    const pending = specs
      .map((spec) => ({ spec, signature: `${spec.kind}:${spec.font ?? ""}:${spec.source}` }))
      .filter(({ spec, signature }) => this.signatures.get(spec.id) !== signature);
    if (pending.length === 0) return;

    let next = 0;
    let done = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= pending.length) return;
        const { spec, signature } = pending[index];
        const measured = measure(await rasterize(spec));
        this.entries.set(spec.id, { spec, ...measured });
        this.signatures.set(spec.id, signature);
        done += 1;
        onProgress?.(done, pending.length);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, pending.length) }, worker),
    );
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
