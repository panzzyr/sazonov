import { glyphPlacements, outputSize, type RenderOptions } from "../engine/render";
import { solveRamp } from "../engine/ramp";

const traceThreshold = 32;

function decimal(value: number) {
  return Number(value.toFixed(3)).toString();
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

type Rectangle = { x: number; y: number; width: number; height: number };

/**
 * Traces a measured alpha mask into vertically merged pixel runs.
 *
 * The measured mask is the canonical form used by the canvas renderer for
 * shipped vectors, type, and scanned marks alike. Tracing that form means the
 * SVG preserves the same tight box and ink decision instead of quietly using a
 * different interpretation of an uploaded file.
 */
export function traceAlpha(alpha: Uint8ClampedArray, width: number, height: number) {
  const rectangles: Rectangle[] = [];
  let active = new Map<string, Rectangle>();

  for (let y = 0; y < height; y += 1) {
    const next = new Map<string, Rectangle>();
    let x = 0;
    while (x < width) {
      while (x < width && alpha[y * width + x] < traceThreshold) x += 1;
      const start = x;
      while (x < width && alpha[y * width + x] >= traceThreshold) x += 1;
      if (x === start) continue;
      const key = `${start}:${x}`;
      const rectangle = active.get(key) ?? { x: start, y, width: x - start, height: 0 };
      rectangle.height += 1;
      next.set(key, rectangle);
    }
    for (const [key, rectangle] of active) {
      if (!next.has(key)) rectangles.push(rectangle);
    }
    active = next;
  }
  rectangles.push(...active.values());

  return rectangles
    .map((rectangle) => `M${rectangle.x} ${rectangle.y}h${rectangle.width}v${rectangle.height}h-${rectangle.width}z`)
    .join("");
}

export function traceMask(bitmap: HTMLCanvasElement) {
  const context = bitmap.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  const { width, height } = bitmap;
  const pixels = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3];
  return traceAlpha(alpha, width, height);
}

function rgb(red: number, green: number, blue: number, invert: boolean) {
  return invert
    ? `rgb(${255 - red} ${255 - green} ${255 - blue})`
    : `rgb(${red} ${green} ${blue})`;
}

/** A traced, editable SVG of the currently visible glyph frame. */
export function exportSvg(options: Omit<RenderOptions, "ink">, title: string) {
  if (options.settings.mode !== "glyph") {
    throw new Error("Traced SVG is available in glyph mode.");
  }

  const { settings, field, library } = options;
  const ramp = options.ramp ?? solveRamp(settings, library.metrics);
  const { width, height, cell } = outputSize(settings, field);
  const placements = [...glyphPlacements({ ...options, ink: "flat", ramp }, ramp, cell)];
  const used = [...new Set(placements.map((placement) => placement.glyph.spec.id))];
  const symbolIds = new Map(used.map((id, index) => [id, `mark-${index}`]));

  const symbols = used.map((id) => {
    const glyph = library.get(id);
    if (!glyph) return "";
    const path = traceMask(glyph.bitmap);
    return `<symbol id="${symbolIds.get(id)}" viewBox="0 0 ${glyph.bitmap.width} ${glyph.bitmap.height}"><path d="${path}"/></symbol>`;
  }).join("");

  const marks = placements.map((placement) => {
    const x = placement.centreX - placement.width / 2;
    const y = placement.centreY - placement.height / 2;
    const rotation = placement.rotation === 0
      ? ""
      : ` transform="rotate(${decimal((placement.rotation * 180) / Math.PI)} ${decimal(placement.centreX)} ${decimal(placement.centreY)})"`;
    return `<use href="#${symbolIds.get(placement.glyph.spec.id)}" x="${decimal(x)}" y="${decimal(y)}" width="${decimal(placement.width)}" height="${decimal(placement.height)}"${rotation}/>`;
  }).join("");

  const ink = settings.invert ? "#ffffff" : "#000000";
  const paper = settings.invert ? "#000000" : "#ffffff";
  let colour = `<rect width="${width}" height="${height}" fill="${ink}"/>`;
  if (settings.colorMode === "source") {
    const cells: string[] = [];
    for (let index = 0; index < field.gridW * field.gridH; index += 1) {
      const x = (index % field.gridW) * cell;
      const y = Math.floor(index / field.gridW) * cell;
      const offset = index * 3;
      cells.push(`<rect x="${decimal(x)}" y="${decimal(y)}" width="${decimal(cell + 0.02)}" height="${decimal(cell + 0.02)}" fill="${rgb(field.color[offset], field.color[offset + 1], field.color[offset + 2], settings.invert)}"/>`);
    }
    colour = cells.join("");
  }

  const document = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${xml(title)}</title>`,
    `<desc>Generated locally by glyph art. Mark masks were traced into vector paths.</desc>`,
    `<defs>${symbols}<mask id="marks" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><g fill="#fff">${marks}</g></mask></defs>`,
    `<rect width="${width}" height="${height}" fill="${paper}"/>`,
    `<g mask="url(#marks)">${colour}</g>`,
    `</svg>`,
  ].join("");

  return new Blob([document], { type: "image/svg+xml" });
}
