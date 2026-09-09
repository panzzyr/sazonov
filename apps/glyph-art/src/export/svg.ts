/**
 * Vector export.
 *
 * Both modes end up here, and they arrive as different kinds of drawing.
 *
 * A glyph frame is *traced*: its marks are bitmaps — scans, type, uploaded
 * files — measured into alpha masks, and the honest vector of a scan is its
 * contour. A halftone frame is not traced at all, because it was never a
 * bitmap: the dots are solved from area as circles, ellipses and polygons, so
 * the SVG can carry the same geometry the canvas filled, exactly.
 *
 * That is why the halftone path shares `engine/halftone`'s dot sink rather
 * than tracing the rendered canvas. A traced screen would be a picture of a
 * halftone at one resolution; this is the screen itself, and it stays crisp at
 * any size a press asks for.
 */

import { glyphPlacements, type RenderOptions } from "../engine/render";
import { solveRamp } from "../engine/ramp";
import {
  dotOutline,
  plateColors,
  plateNames,
  screenAngles,
  screenDots,
  screenPitch,
  type DotSink,
} from "../engine/halftone";
import type { Settings } from "../types";
import type { ToneField } from "../engine/tone";

const traceThreshold = 32;

function decimal(value: number, digits = 3) {
  return Number(value.toFixed(digits)).toString();
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

type Frame = { width: number; height: number };

export type SvgOptions = Omit<RenderOptions, "ink"> & {
  /**
   * The frame, from `sequenceSize`.
   *
   * Passed in rather than re-derived here for the same reason the halftone
   * renderer takes it: one place decides the size, so the vector frame and the
   * raster frame cannot disagree by a rounded pixel.
   */
  size: Frame;
};

/** Wraps a body in the document every mode shares. */
function svgDocument(size: Frame, title: string, description: string, body: string) {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}" viewBox="0 0 ${size.width} ${size.height}">`,
    `<title>${xml(title)}</title>`,
    `<desc>${xml(description)}</desc>`,
    body,
    `</svg>`,
  ].join("");
}

/** The traced glyph frame: one symbol per mark, placed by the renderer's own geometry. */
function glyphBody(options: SvgOptions) {
  const { settings, field, library, size } = options;
  const ramp = options.ramp ?? solveRamp(settings, library.metrics);
  const cell = size.width / field.gridW;
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
  let colour = `<rect width="${size.width}" height="${size.height}" fill="${ink}"/>`;
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

  return [
    `<defs>${symbols}<mask id="marks" maskUnits="userSpaceOnUse" x="0" y="0" width="${size.width}" height="${size.height}"><g fill="#fff">${marks}</g></mask></defs>`,
    `<rect width="${size.width}" height="${size.height}" fill="${paper}"/>`,
    `<g mask="url(#marks)">${colour}</g>`,
  ].join("");
}

/**
 * Writes dots as path data, at two decimals.
 *
 * Two decimals is a hundredth of a pixel on a frame that is pixels wide, which
 * is far below anything a curve can show — and a screen is tens of thousands
 * of dots, so the digits that carry no information are the file size.
 *
 * Every subpath is wound the same way, clockwise, because the plates are
 * filled `nonzero`: two overlapping dots wound against each other would
 * cancel and print a hole.
 */
function svgPathSink(): DotSink & { data(): string } {
  const parts: string[] = [];
  const n = (value: number) => decimal(value, 2);

  return {
    circle(x, y, radius) {
      const r = n(radius);
      const span = n(radius * 2);
      parts.push(`M${n(x - radius)} ${n(y)}a${r} ${r} 0 1 1 ${span} 0a${r} ${r} 0 1 1 -${span} 0Z`);
    },
    ellipse(x, y, major, minor, angle) {
      const degrees = n((angle * 180) / Math.PI);
      const dx = major * Math.cos(angle);
      const dy = major * Math.sin(angle);
      parts.push(
        `M${n(x + dx)} ${n(y + dy)}`
        + `A${n(major)} ${n(minor)} ${degrees} 0 1 ${n(x - dx)} ${n(y - dy)}`
        + `A${n(major)} ${n(minor)} ${degrees} 0 1 ${n(x + dx)} ${n(y + dy)}Z`,
      );
    },
    polygon(points) {
      const [first, ...rest] = points;
      parts.push(
        `M${n(first[0])} ${n(first[1])}`
        + rest.map(([x, y]) => `L${n(x)} ${n(y)}`).join("")
        + "Z",
      );
    },
    data() {
      return parts.join("");
    },
  };
}

/** #rrggbb, or #rgb, to its negative. */
function negate(color: string) {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return color;
  return `#${(0xffffff - value).toString(16).padStart(6, "0")}`;
}

/**
 * The halftone frame: one path per plate, in its own ink.
 *
 * The plates multiply, which is what makes overlapping inks subtract instead
 * of brighten, and is exactly what the canvas renderer does. Inverting is not
 * a second compositing model: the negative of a multiply is the same screen of
 * negated inks on black paper — `1 − ab` is `screen(1 − a, 1 − b)` — so the
 * inverted export is the same geometry with two attributes changed.
 *
 * A single plate needs no blend at all: black dots on white paper are the same
 * under any of them, and leaving the attribute off keeps a mono export
 * openable by editors that have never heard of blend modes.
 */
function halftoneBody(settings: Settings, field: ToneField, size: Frame) {
  const halftone = settings.halftone;
  const pitch = screenPitch(size.width, halftone);
  const angles = screenAngles(halftone);
  const names = plateNames(halftone);
  const colors = plateColors(halftone);
  const sinks = angles.map(() => svgPathSink());

  for (const dot of screenDots(settings, field, size.width, size.height)) {
    dotOutline(sinks[dot.plate], halftone.shape, dot.x, dot.y, pitch, dot.area, angles[dot.plate]);
  }

  const blend = angles.length > 1
    ? ` style="mix-blend-mode:${settings.invert ? "screen" : "multiply"}"`
    : "";
  const plates = sinks.map((sink, index) => {
    const data = sink.data();
    if (!data) return "";
    const ink = settings.invert ? negate(colors[index]) : colors[index];
    return `<path id="plate-${xml(names[index])}" fill="${ink}"${blend} d="${data}"/>`;
  }).join("");

  return `<rect width="${size.width}" height="${size.height}" fill="${settings.invert ? "#000000" : "#ffffff"}"/>${plates}`;
}

/** An editable SVG of the currently visible frame, in whichever mode it is. */
export function exportSvg(options: SvgOptions, title: string) {
  const { settings, field, size } = options;

  if (settings.mode === "halftone") {
    return new Blob([svgDocument(
      size,
      title,
      "Generated locally by glyph art. Each plate is one path of screen dots, "
      + "solved from ink area rather than traced.",
      halftoneBody(settings, field, size),
    )], { type: "image/svg+xml" });
  }

  return new Blob([svgDocument(
    size,
    title,
    "Generated locally by glyph art. Mark masks were traced into vector paths.",
    glyphBody(options),
  )], { type: "image/svg+xml" });
}
