/**
 * Rasterizing and measuring marks.
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
 * Shipped preset marks are the one thing that comes off the network, and they
 * come off it as images: sprite sheets under the site's own base, loaded
 * through the same `<img>` and covered by `img-src 'self'`. A sheet is turned
 * into one ink mask, and every mark on it is a box on that mask rather than a
 * canvas of its own — nearly three thousand canvases at 256 px would be half a
 * gigabyte. Sheet marks are measured at the pixels they ship at, which are the
 * pixels the build measured; see `scripts/build-glyph-presets.mjs`.
 */

import { fontStacks, type GlyphSpec } from "../types";

/** Marks are measured and cached at this size, then scaled down when drawn. */
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
   * Ink mask: black, with alpha carrying the ink. For a preset mark this is
   * its whole sprite sheet, shared with the rest of the set.
   */
  bitmap: HTMLCanvasElement;
  /** Where the mark's tight box sits on `bitmap`. */
  box: MarkBox;
};

/** Draws a mark's tight box into a rectangle — the one way a mark is drawn. */
export function drawGlyph(
  context: CanvasRenderingContext2D,
  glyph: MeasuredGlyph,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const { box } = glyph;
  context.drawImage(glyph.bitmap, box.x, box.y, box.width, box.height, x, y, width, height);
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
  return { density: 0, aspect: 1, bitmap, box: { ...at, width: 1, height: 1 } };
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
function measure(canvas: HTMLCanvasElement): Measured {
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

  return {
    density: box.density,
    aspect: box.width / box.height,
    bitmap: mask,
    box: { x: 0, y: 0, width: box.width, height: box.height },
  };
}

type Sheet = {
  /** The sheet as an ink mask, shared by every mark on it. */
  mask: HTMLCanvasElement;
  /** Ink per pixel, 0..255, kept to measure marks without reading the mask back. */
  ink: Uint8ClampedArray;
  width: number;
};

/**
 * Loads a sprite sheet and turns it into an ink mask.
 *
 * The pixels are read on a scratch canvas and the mask is written to a fresh
 * one: a canvas asked for `willReadFrequently` may be kept in software, and
 * this one is drawn from thousands of times a frame.
 */
async function loadSheet(source: string): Promise<Sheet> {
  const image = await loadImage(`${import.meta.env.BASE_URL}${source}`);
  const width = image.naturalWidth;
  const height = image.naturalHeight;

  const scratch = makeCanvas(width, height).getContext("2d", { willReadFrequently: true });
  if (!scratch) throw new Error("This browser did not give us a 2D canvas.");
  scratch.drawImage(image, 0, 0);
  const pixels = scratch.getImageData(0, 0, width, height);
  const data = pixels.data;

  const ink = new Uint8ClampedArray(width * height);
  for (let index = 0; index < ink.length; index += 1) {
    const offset = index * 4;
    const luma = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2];
    ink[index] = (data[offset + 3] / 255) * (255 - luma);
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = ink[index];
  }

  const mask = makeCanvas(width, height);
  const context = mask.getContext("2d");
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  context.putImageData(pixels, 0, 0);
  return { mask, ink, width };
}

/** Measures one mark on a sheet, by its box there. */
function measureOnSheet(sheet: Sheet, [x, y, width, height]: [number, number, number, number]): Measured {
  const box = inkBox(sheet.ink, sheet.width, 255, { x, y, width, height });
  if (!box) return blank(sheet.mask, { x, y, width, height });
  return {
    density: box.density,
    aspect: box.width / box.height,
    bitmap: sheet.mask,
    box: { x: box.x, y: box.y, width: box.width, height: box.height },
  };
}

/**
 * Measured marks, keyed by id. The renderer asks it for a mask every cell, so
 * lookups are synchronous; loading happens once, up front, in `ensure`.
 */
export class GlyphLibrary {
  private entries = new Map<string, MeasuredGlyph>();
  private signatures = new Map<string, string>();
  private sheets = new Map<string, Promise<Sheet>>();

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

  private sheet(source: string) {
    let sheet = this.sheets.get(source);
    if (!sheet) {
      sheet = loadSheet(source);
      this.sheets.set(source, sheet);
      // A failed load is not cached, so the next `ensure` tries again.
      sheet.catch(() => this.sheets.delete(source));
    }
    return sheet;
  }

  /**
   * Loads anything new or changed, and forgets marks no longer in the set.
   *
   * Preset marks arrive a sheet at a time: each sheet is one request and one
   * decode, and every mark on it is then measured off pixels already in hand.
   * Loose marks — uploads, typed characters, the shipped SVGs — load a few at
   * a time, because a folder of uploads one after another is a long wait.
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
    const sources = new Set(specs.filter((spec) => spec.rect).map((spec) => spec.source));
    for (const source of [...this.sheets.keys()]) {
      if (!sources.has(source)) this.sheets.delete(source);
    }

    const pending = specs
      .map((spec) => ({
        spec,
        signature: `${spec.kind}:${spec.font ?? ""}:${spec.source}:${spec.rect?.join(",") ?? ""}`,
      }))
      .filter(({ spec, signature }) => this.signatures.get(spec.id) !== signature);
    if (pending.length === 0) return;

    let done = 0;
    const settle = (spec: GlyphSpec, signature: string, measured: Measured) => {
      this.entries.set(spec.id, { spec, ...measured });
      this.signatures.set(spec.id, signature);
      done += 1;
      onProgress?.(done, pending.length);
    };

    const bySheet = new Map<string, typeof pending>();
    const loose: typeof pending = [];
    for (const entry of pending) {
      if (!entry.spec.rect) {
        loose.push(entry);
        continue;
      }
      const group = bySheet.get(entry.spec.source);
      if (group) group.push(entry);
      else bySheet.set(entry.spec.source, [entry]);
    }

    const sheetWork = [...bySheet].map(async ([source, group]) => {
      const sheet = await this.sheet(source);
      for (const { spec, signature } of group) settle(spec, signature, measureOnSheet(sheet, spec.rect!));
    });

    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= loose.length) return;
        const { spec, signature } = loose[index];
        settle(spec, signature, measure(await rasterize(spec)));
      }
    };

    await Promise.all([
      ...sheetWork,
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
