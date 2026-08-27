/**
 * The halftone screen.
 *
 * A different principle from the rest of the tool, and worth being explicit
 * about why it needs its own module rather than another dot-shaped mark.
 *
 * glyph art puts one mark in one cell of a square grid and carries tone in the
 * mark's *size*. A halftone has no cells and no grid: it has a lattice of dot
 * centres at a chosen ruling, rotated to a chosen angle that has nothing to do
 * with the frame, and tone is carried by the dot's *area*. Colour is not one
 * ink tinted per cell either — the image is separated into plates, each with
 * its own screen at its own angle, and the plates are multiplied together the
 * way wet ink is. Rotating a mark grid or tinting its marks cannot produce a
 * rosette; only actually screening each plate separately can.
 *
 * So this file owns three things the glyph path has no notion of:
 *
 *   the lattice   — a rotated, frame-independent grid of dot centres
 *   the plates    — separation into inks, each with its own screen angle
 *   the dot       — area solved from tone, then given a shape
 *
 * It shares the tone field with the glyph path, and nothing else. Everything
 * above `HalftoneRenderer` is arithmetic and runs in a test without a canvas.
 */

import { lightness, type ToneField } from "./tone";
import {
  type ExportInk,
  type HalftoneSettings,
  type Separation,
  type Settings,
} from "../types";

/**
 * Screen angles per plate, in degrees, before the user's rotation.
 *
 * The classic set. Two screens 30° apart make a rosette; two screens a few
 * degrees apart make a moiré the size of the page. Yellow sits at 0 because it
 * is the plate the eye forgives, and black at 45 because it is the plate the
 * eye reads, and 45 is the angle a dot grid disappears at.
 */
const plateAngles: Record<Separation, number[]> = {
  mono: [0],
  duotone: [0, 30],
  cmyk: [15, 75, 0, 45],
};

const plateLabels: Record<Separation, string[]> = {
  mono: ["black"],
  duotone: ["ink-one", "ink-two"],
  cmyk: ["cyan", "magenta", "yellow", "black"],
};

/**
 * Pure secondaries, not press approximations. Multiplying pure cyan, magenta
 * and yellow is what actually subtracts light correctly; a "realistic" cyan
 * would double-count the ink's own impurity against a screen that already
 * shows it.
 */
const processInks = ["#00ffff", "#ff00ff", "#ffff00", "#000000"];

export function plateCount(settings: HalftoneSettings) {
  return plateAngles[settings.separation].length;
}

export function plateNames(settings: HalftoneSettings) {
  return plateLabels[settings.separation];
}

export function plateColors(settings: HalftoneSettings) {
  if (settings.separation === "cmyk") return processInks;
  if (settings.separation === "duotone") return [settings.inks[0], settings.inks[1]];
  return ["#000000"];
}

export function screenAngles(settings: HalftoneSettings) {
  return plateAngles[settings.separation].map(
    (offset) => ((settings.angle + offset) * Math.PI) / 180,
  );
}

/**
 * Ink each plate owes for one colour, 0..1.
 *
 * Mono and duotone work off lightness: one screen carrying the whole range,
 * or two where the second is pulled towards the midtones so the pair reads as
 * two inks rather than as one ink printed twice.
 *
 * CMYK is the naive conversion with grey component replacement. `black` says
 * how much of the neutral the black plate carries alone: at 0 the greys are
 * built from all three chromatic inks, which is rich and registers badly; at 1
 * black does the neutrals by itself, which is what newsprint does.
 */
export function separate(
  red: number,
  green: number,
  blue: number,
  separation: Separation,
  black: number,
): number[] {
  if (separation === "cmyk") {
    const neutral = 1 - Math.max(red, green, blue);
    if (neutral >= 1) return [0, 0, 0, 1];
    const key = neutral * Math.max(0, Math.min(1, black));
    const rest = 1 - key;
    const plate = (channel: number) => Math.max(0, Math.min(1, (1 - channel - key) / rest));
    return [plate(red), plate(green), plate(blue), key];
  }

  const tone = 1 - lightness(0.2126 * red + 0.7152 * green + 0.0722 * blue);
  if (separation === "duotone") {
    // The second ink is held out of the highlights so it colours the middle of
    // the range rather than tinting the whole print evenly.
    return [tone, Math.max(0, Math.min(1, (tone - 0.15) / 0.85)) ** 1.6];
  }
  return [tone];
}

/** Ink area a plate value asks for, as a fraction of one screen cell. */
export function dotArea(value: number, gain: number) {
  return Math.max(0, Math.min(1, value)) ** gain;
}

export type Lattice = { pitch: number; from: number; to: number; rows: number; columns: number };

/**
 * The range of lattice indices whose dots can touch the frame.
 *
 * The lattice is rotated, so the frame's corners have to be carried into
 * screen space to find it. A cell of slack on each side keeps the dots that
 * straddle an edge — without it a rotated screen has a visible bald border.
 */
export function latticeRange(width: number, height: number, pitch: number, angle: number) {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;

  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const u = x * cos - y * sin;
    const v = x * sin + y * cos;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }

  return {
    fromU: Math.floor(minU / pitch) - 1,
    toU: Math.ceil(maxU / pitch) + 1,
    fromV: Math.floor(minV / pitch) - 1,
    toV: Math.ceil(maxV / pitch) + 1,
  };
}

/**
 * Bilinear tone lookup, in frame pixels.
 *
 * The tone field is sampled far finer than the screen, so a dot reads the
 * image at its own centre rather than an average of the cell it happens to sit
 * in. Nearest-neighbour here would quantize the picture to the field's
 * resolution and put a visible staircase through every soft gradient.
 */
function sampleColor(field: ToneField, x: number, y: number, out: Float32Array) {
  const fx = Math.max(0, Math.min(field.gridW - 1, x - 0.5));
  const fy = Math.max(0, Math.min(field.gridH - 1, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.gridW - 1, x0 + 1);
  const y1 = Math.min(field.gridH - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  for (let channel = 0; channel < 3; channel += 1) {
    const a = field.color[(y0 * field.gridW + x0) * 3 + channel];
    const b = field.color[(y0 * field.gridW + x1) * 3 + channel];
    const c = field.color[(y1 * field.gridW + x0) * 3 + channel];
    const d = field.color[(y1 * field.gridW + x1) * 3 + channel];
    const top = a + (b - a) * tx;
    const bottom = c + (d - c) * tx;
    out[channel] = (top + (bottom - top) * ty) / 255;
  }
}

/**
 * Applies the black and white points, keeping the hue.
 *
 * The levels are authored against lightness — they come from the same
 * auto-levels the glyph path uses — so they are applied to lightness and the
 * colour is scaled to follow. Stretching each channel separately instead would
 * shift the hue of everything that is not already neutral.
 */
function applyLevels(color: Float32Array, min: number, max: number) {
  const luminance = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const light = lightness(luminance);
  if (light <= 1e-4) return;
  const span = Math.max(1e-4, max - min);
  const corrected = Math.max(0, Math.min(1, (light - min) / span));
  const scale = corrected / light;
  for (let channel = 0; channel < 3; channel += 1) {
    color[channel] = Math.max(0, Math.min(1, color[channel] * scale));
  }
}

/**
 * Adds one dot to the current path.
 *
 * Every shape is solved from the same area, so changing shape changes the
 * texture of the print and not its tone. That is the whole reason to solve
 * from area rather than from a radius: a square dot and a round dot at the
 * same "size" are a third of a tone apart.
 */
function addDot(
  path: Path2D,
  shape: HalftoneSettings["shape"],
  x: number,
  y: number,
  pitch: number,
  area: number,
  angle: number,
) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  if (shape === "round") {
    path.moveTo(x + pitch * Math.sqrt(area / Math.PI), y);
    path.arc(x, y, pitch * Math.sqrt(area / Math.PI), 0, Math.PI * 2);
    return;
  }

  if (shape === "ellipse") {
    const radius = pitch * Math.sqrt(area / Math.PI);
    const major = radius * 1.4;
    // `ellipse` joins the current point with a line unless a subpath is opened
    // on its own start, which for a rotated ellipse is not simply (x + rx, y).
    path.moveTo(x + major * cos, y + major * sin);
    path.ellipse(x, y, major, radius / 1.4, angle, 0, Math.PI * 2);
    return;
  }

  // Everything below is a polygon in screen space, carried into frame space by
  // hand. Rotating the context per dot would cost a state change per dot and
  // stop the plate from being one path and one fill.
  const place = (u: number, v: number): [number, number] => [
    x + u * cos - v * sin,
    y + u * sin + v * cos,
  ];
  const polygon = (points: [number, number][]) => {
    const [first, ...rest] = points.map(([u, v]) => place(u, v));
    path.moveTo(first[0], first[1]);
    for (const [px, py] of rest) path.lineTo(px, py);
    path.closePath();
  };

  if (shape === "square") {
    const half = (pitch * Math.sqrt(area)) / 2;
    polygon([[-half, -half], [half, -half], [half, half], [-half, half]]);
    return;
  }

  if (shape === "diamond") {
    // Half-diagonal of a square standing on its corner: area = 2d².
    const d = pitch * Math.sqrt(area / 2);
    polygon([[0, -d], [d, 0], [0, d], [-d, 0]]);
    return;
  }

  if (shape === "line") {
    // A bar across the whole cell: area = pitch × thickness.
    const half = (pitch * area) / 2;
    const span = pitch / 2;
    polygon([[-span, -half], [span, -half], [span, half], [-span, half]]);
    return;
  }

  // Cross: two bars of thickness t, overlapping once.
  //   area = 2·pitch·t − t²  →  t = pitch·(1 − sqrt(1 − area))
  const thickness = (pitch * (1 - Math.sqrt(Math.max(0, 1 - area)))) / 2;
  const span = pitch / 2;
  polygon([[-span, -thickness], [span, -thickness], [span, thickness], [-span, thickness]]);
  polygon([[-thickness, -span], [thickness, -span], [thickness, span], [-thickness, span]]);
}

export type HalftoneOptions = {
  settings: Settings;
  field: ToneField;
  ink: ExportInk;
  /**
   * The frame to draw, from `sequenceSize`.
   *
   * Passed in rather than derived from the tone field: the field's grid is
   * itself a rounding of the source's proportion, so re-deriving the frame
   * from it lands a pixel or two off what the export was told to expect. One
   * place decides the size, and both the preview and the encoder read it.
   */
  frame: { width: number; height: number };
  /** Render this plate alone, as black on white — a printing plate. */
  plate?: number;
};

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  return context;
}

export class HalftoneRenderer {
  private plate = document.createElement("canvas");
  private union = document.createElement("canvas");

  constructor(private canvas: HTMLCanvasElement) {}

  render({ settings, field, ink, plate, frame }: HalftoneOptions) {
    const halftone = settings.halftone;
    const { width, height } = frame;
    for (const canvas of [this.canvas, this.plate, this.union]) {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    }

    const pitch = width / Math.max(1, halftone.lines);
    const angles = screenAngles(halftone);
    const colors = plateColors(halftone);
    const paths = this.screen(settings, field, width, height, pitch, angles);

    const target = context2d(this.canvas);
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalCompositeOperation = "source-over";

    if (plate !== undefined) {
      target.fillStyle = "#ffffff";
      target.fillRect(0, 0, width, height);
      target.fillStyle = "#000000";
      if (paths[plate]) target.fill(paths[plate], "nonzero");
      return;
    }

    // Paper first, then each plate multiplied into it: overlapping inks
    // subtract, which is the whole reason a rosette looks like ink and an
    // additive blend looks like a screenshot of ink.
    target.fillStyle = "#ffffff";
    target.fillRect(0, 0, width, height);
    for (let index = 0; index < paths.length; index += 1) {
      this.paintPlate(paths[index], colors[index], width, height);
      target.globalCompositeOperation = "multiply";
      target.drawImage(this.plate, 0, 0);
    }
    target.globalCompositeOperation = "source-over";

    // Negate before keying, not after: `difference` against an already keyed
    // frame would turn the transparent paper into opaque white.
    if (settings.invert) this.negate(target, width, height);
    if (ink !== "flat") this.key(paths, ink, width, height);
  }

  /** One path per plate, built in a single pass over each plate's lattice. */
  private screen(
    settings: Settings,
    field: ToneField,
    width: number,
    height: number,
    pitch: number,
    angles: number[],
  ) {
    const { halftone, levels } = settings;
    const paths = angles.map(() => new Path2D());
    const color = new Float32Array(3);
    const scaleX = field.gridW / width;
    const scaleY = field.gridH / height;

    for (let index = 0; index < angles.length; index += 1) {
      const angle = angles[index];
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const range = latticeRange(width, height, pitch, angle);

      for (let v = range.fromV; v <= range.toV; v += 1) {
        const screenV = (v + 0.5) * pitch;
        for (let u = range.fromU; u <= range.toU; u += 1) {
          const screenU = (u + 0.5) * pitch;
          const x = screenU * cos - screenV * sin;
          const y = screenU * sin + screenV * cos;
          if (x < -pitch || y < -pitch || x > width + pitch || y > height + pitch) continue;

          sampleColor(field, x * scaleX, y * scaleY, color);
          applyLevels(color, levels.min, levels.max);
          const inks = separate(
            color[0],
            color[1],
            color[2],
            halftone.separation,
            halftone.blackGeneration,
          );

          // `spread` is a linear scale on the dot, the way ink spreading into
          // paper is, so it enters the area as its square.
          const area = dotArea(inks[index], halftone.gain) * halftone.spread ** 2;
          if (area <= 0.0005) continue;
          addDot(paths[index], halftone.shape, x, y, pitch, Math.min(1.6, area), angle);
        }
      }
    }

    return paths;
  }

  /** Draws one plate's dots in its own ink on transparency. */
  private paintPlate(path: Path2D, color: string, width: number, height: number) {
    const context = context2d(this.plate);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = color;
    context.fill(path, "nonzero");
  }

  /**
   * Keys the paper or the ink to transparency.
   *
   * The union of every plate's dots is where ink landed, whatever colour it
   * was. Keying on that rather than on the composite's own alpha is what keeps
   * a pale yellow dot in the `ink` pass instead of dropping it for being close
   * to paper.
   */
  private key(paths: Path2D[], ink: ExportInk, width: number, height: number) {
    const context = context2d(this.union);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#000000";
    for (const path of paths) context.fill(path, "nonzero");

    const target = context2d(this.canvas);
    target.globalCompositeOperation = ink === "ink" ? "destination-in" : "destination-out";
    target.drawImage(this.union, 0, 0);
    target.globalCompositeOperation = "source-over";
  }

  /** Swaps ink and paper by taking the frame's negative. */
  private negate(context: CanvasRenderingContext2D, width: number, height: number) {
    context.globalCompositeOperation = "difference";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";
  }
}
