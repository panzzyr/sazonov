/**
 * Vector export.
 *
 * Both modes end up here, and they arrive as different kinds of drawing.
 *
 * All glyph marks arrive as prepared outlines, also used by PNG and MP4.
 * Shipped reaction icons and counters retain their authored curves.
 * A halftone frame is not traced at all, because it was never a
 * bitmap: the dots are solved from area as circles, ellipses and polygons, so
 * the SVG can carry the same geometry the canvas filled, exactly.
 *
 * That is why the halftone path shares `engine/halftone`'s dot sink rather
 * than tracing the rendered canvas. A traced screen would be a picture of a
 * halftone at one resolution; this is the screen itself, and it stays crisp at
 * any size a press asks for.
 *
 * **Everything written here is plain filled paths.** No `<use>`, no
 * `<symbol>`, no `<mask>`: a browser resolves all three and a drawing program
 * may resolve none of them — Illustrator wants the SVG 1.1 `xlink:href` on a
 * `<use>`, Figma does not follow the reference at all — and a file that opens
 * empty in the program it was exported for is not an export. Sharing one
 * definition between impressions is what those elements buy, so the geometry
 * is written out per impression instead and `export/trace.ts` earns that back
 * by making each outline small.
 *
 * One path per ink, not one per mark: a frame is thousands of impressions, and
 * an editor that is handed thousands of objects crawls. Overlapping marks
 * inside one path merge under `nonzero`, which is the same union the canvas
 * renderer builds in alpha.
 */

import { cellGeometry, glyphPlacements, type RenderOptions } from "../engine/render";
import { solveRamp } from "../engine/ramp";
import type { Point } from "./trace";
import { glyphOutline } from "../engine/glyphLibrary";
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

/**
 * The glyph frame: every impression written out, gathered by ink.
 *
 * Prepared outlines are carried into place — scaled to the impression's box and
 * rotated about its centre — because a shared definition would mean the
 * `<use>` that editors refuse.
 *
 * In source-colour mode a mark takes the colour of the cell it belongs to,
 * where the canvas paints per-cell colour through the mask and a mark spilling
 * over a border picks up its neighbour's colour along the way. One mark, one
 * ink is what an editor can work with, and it is the tint the mark was sized
 * for in the first place.
 */
function glyphBody(options: SvgOptions) {
  const { settings, field, library, size } = options;
  const ramp = options.ramp ?? solveRamp(settings, library.metrics);
  const geometry = cellGeometry(settings, size.width, field.gridW, size.height, field.gridH);
  const paper = settings.invert ? "#000000" : "#ffffff";
  const inks = new Map<string, string[]>();

  for (const placement of glyphPlacements({ ...options, ink: "flat", ramp }, ramp, geometry)) {
    const { glyph, width, height, centreX, centreY, rotation } = placement;
    const outline = glyphOutline(glyph);
    if (outline.contours.length === 0) continue;
    // Every output shares complete outlines, including in dense grids where
    // a counter can occupy just a few pixels. Avoid coarse export quantization.
    const digits = 3;
    const n = (value: number) => decimal(value, digits);

    // The impression's own transform, applied to the points rather than
    // written as an attribute: a transform on a shared path is a `<use>` by
    // another name, and one path per ink can only carry one of them.
    const scaleX = width / outline.width;
    const scaleY = height / outline.height;
    const left = centreX - width / 2;
    const top = centreY - height / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const place = (point: Point): Point => {
      const x = left + point[0] * scaleX;
      const y = top + point[1] * scaleY;
      if (rotation === 0) return [x, y];
      const dx = x - centreX;
      const dy = y - centreY;
      return [centreX + dx * cos - dy * sin, centreY + dx * sin + dy * cos];
    };

    // Relative lines, because the numbers are then the length of a step and
    // not the position of one: a step is a couple of pixels where a position
    // is four digits, and a frame holds hundreds of thousands of them.
    const data = outline.contours.map(({ start, segments }) => {
      const head = place(start);
      // Measure every relative step from the written point to avoid cumulative
      // rounding drift; every outline keeps thousandth-pixel export precision.
      let written: Point = [Number(n(head[0])), Number(n(head[1]))];
      let run = `M${n(written[0])} ${n(written[1])}`;
      const step = (point: Point): Point => {
        const at = place(point);
        return [Number(n(at[0] - written[0])), Number(n(at[1] - written[1]))];
      };

      for (const segment of segments) {
        const end = step(segment.to);
        if (segment.kind === "line") {
          if (end[0] === 0 && end[1] === 0) continue;
          run += `l${n(end[0])} ${n(end[1])}`;
        } else {
          const first = step(segment.first);
          const second = step(segment.second);
          run += `c${n(first[0])} ${n(first[1])}`
            + ` ${n(second[0])} ${n(second[1])}`
            + ` ${n(end[0])} ${n(end[1])}`;
        }
        written = [written[0] + end[0], written[1] + end[1]];
      }
      return `${run}Z`;
    }).join("");

    const ink = settings.colorMode === "source"
      ? rgb(
        field.color[placement.cellIndex * 3],
        field.color[placement.cellIndex * 3 + 1],
        field.color[placement.cellIndex * 3 + 2],
        settings.invert,
      )
      : (settings.invert ? "#ffffff" : "#000000");
    const bucket = inks.get(ink);
    if (bucket) bucket.push(data);
    else inks.set(ink, [data]);
  }

  const paths = [...inks].map(([ink, data], index) =>
    `<path id="ink-${index}" fill="${ink}" d="${data.join("")}"/>`).join("");

  return `<rect width="${size.width}" height="${size.height}" fill="${paper}"/>${paths}`;
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
    "Generated locally by glyph art. Prepared vector outlines are shared with PNG and MP4; native vectors retain original contours.",
    glyphBody(options),
  )], { type: "image/svg+xml" });
}
