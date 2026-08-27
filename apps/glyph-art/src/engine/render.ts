/**
 * Drawing a frame.
 *
 * Marks are stamped onto a mask canvas first, then the mask is coloured in one
 * operation. That is not an optimisation, it is what makes the compositing
 * correct: in monochrome, ink over ink is still ink, so the marks have to
 * *union* rather than stack. Building the union in alpha means overlapping
 * shadows never bruise and draw order is irrelevant.
 *
 * Colouring the mask in one pass is also what makes the source-colour mode
 * cheap — the per-cell average colours are drawn over the mask through the
 * same `source-in`, so tinting forty thousand marks costs one `drawImage`.
 *
 * There is no proxy preview. The raster is derived from the grid, not from the
 * source, so the canvas on screen *is* the export frame.
 */

import { bandFor, type ToneField } from "./tone";
import { cycleIndex, handDraw } from "./cellParams";
import { poolCorrection, solveRamp, type SolvedBand } from "./ramp";
import type { GlyphLibrary } from "./glyphLibrary";
import { cellPixels, minMarkSize, type ExportInk, type Settings } from "../types";

export function outputSize(settings: Settings, field: ToneField) {
  const cell = cellPixels(settings.grid);
  return { cell, width: field.gridW * cell, height: field.gridH * cell };
}

export type RenderOptions = {
  settings: Settings;
  field: ToneField;
  library: GlyphLibrary;
  frame: number;
  ink: ExportInk;
  /** Pre-solved ramp, so a sequence does not re-solve it every frame. */
  ramp?: SolvedBand[];
};

function context2d(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser did not give us a 2D canvas.");
  return context;
}

export class GlyphRenderer {
  private mask = document.createElement("canvas");
  private swatch = document.createElement("canvas");

  constructor(private canvas: HTMLCanvasElement) {}

  render(options: RenderOptions) {
    const { settings, field, library, frame, ink } = options;
    const { cell, width, height } = outputSize(settings, field);
    const ramp = options.ramp ?? solveRamp(settings, library.metrics);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.mask.width !== width || this.mask.height !== height) {
      this.mask.width = width;
      this.mask.height = height;
    }

    const maskContext = context2d(this.mask);
    maskContext.setTransform(1, 0, 0, 1, 0, 0);
    maskContext.globalCompositeOperation = "source-over";
    maskContext.clearRect(0, 0, width, height);
    maskContext.imageSmoothingEnabled = true;
    maskContext.imageSmoothingQuality = "high";

    this.stamp(maskContext, options, ramp, cell);
    this.colorize(maskContext, options, width, height);
    this.compose(options, width, height);
  }

  /** One pass over the grid, stamping each cell's mark into the mask. */
  private stamp(
    context: CanvasRenderingContext2D,
    { settings, field, library, frame }: RenderOptions,
    ramp: SolvedBand[],
    cell: number,
  ) {
    const bandCount = settings.bands.length;
    const rotates = settings.hand > 0;

    for (let y = 0; y < field.gridH; y += 1) {
      for (let x = 0; x < field.gridW; x += 1) {
        const cellIndex = y * field.gridW + x;
        const band = bandFor(field.tone[cellIndex], settings.levels, bandCount, settings.rampInvert);
        const pool = settings.bands[band]?.glyphs;
        if (!pool || pool.length === 0) continue;

        const reference = library.get(pool[0]);
        if (!reference || reference.density <= 0) continue;

        const chosen = pool.length === 1
          ? reference
          : library.get(pool[cycleIndex(settings.seed, cellIndex, pool.length, frame, settings.hold)]);
        if (!chosen || chosen.density <= 0) continue;

        const hand = handDraw(settings.seed, cellIndex, settings.hand);
        // The ceiling binds every mark in the pool, not only the band's
        // reference: a mark corrected up to match the reference's coverage can
        // land past it, and the promise is that no mark overflows its cell by
        // more than the user asked for.
        const size = Math.min(
          settings.maxSize,
          ramp[band].size * poolCorrection(reference, chosen) * hand.sizeScale,
        );
        if (size < minMarkSize) continue;

        const long = size * cell;
        const markWidth = chosen.aspect >= 1 ? long : long * chosen.aspect;
        const markHeight = chosen.aspect >= 1 ? long / chosen.aspect : long;
        const centreX = (x + 0.5 + hand.offsetX) * cell;
        const centreY = (y + 0.5 + hand.offsetY) * cell;

        if (rotates && hand.rotation !== 0) {
          context.save();
          context.translate(centreX, centreY);
          context.rotate(hand.rotation);
          context.drawImage(chosen.bitmap, -markWidth / 2, -markHeight / 2, markWidth, markHeight);
          context.restore();
          continue;
        }
        context.drawImage(
          chosen.bitmap,
          centreX - markWidth / 2,
          centreY - markHeight / 2,
          markWidth,
          markHeight,
        );
      }
    }
  }

  /** Paints the accumulated alpha, either one ink or the source's own colour. */
  private colorize(
    context: CanvasRenderingContext2D,
    { settings, field }: RenderOptions,
    width: number,
    height: number,
  ) {
    context.globalCompositeOperation = "source-in";

    if (settings.colorMode === "mono") {
      context.fillStyle = settings.invert ? "#ffffff" : "#000000";
      context.fillRect(0, 0, width, height);
    } else {
      this.paintSwatch(field, settings.invert);
      // Smoothing off keeps each cell's colour flat, so the marks stay
      // separable instead of dissolving into a blurred photograph.
      context.imageSmoothingEnabled = false;
      context.drawImage(this.swatch, 0, 0, width, height);
      context.imageSmoothingEnabled = true;
    }

    context.globalCompositeOperation = "source-over";
  }

  /** One pixel per cell, holding that cell's average source colour. */
  private paintSwatch(field: ToneField, invert: boolean) {
    if (this.swatch.width !== field.gridW || this.swatch.height !== field.gridH) {
      this.swatch.width = field.gridW;
      this.swatch.height = field.gridH;
    }
    const context = context2d(this.swatch);
    const image = context.createImageData(field.gridW, field.gridH);
    for (let index = 0; index < field.gridW * field.gridH; index += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const value = field.color[index * 3 + channel];
        image.data[index * 4 + channel] = invert ? 255 - value : value;
      }
      image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }

  /** Lays the coloured mask over paper, or keys one of the two to alpha. */
  private compose({ settings, ink }: RenderOptions, width: number, height: number) {
    const context = context2d(this.canvas);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.clearRect(0, 0, width, height);

    const paper = settings.invert ? "#000000" : "#ffffff";

    if (ink === "ink") {
      context.drawImage(this.mask, 0, 0);
      return;
    }

    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);

    if (ink === "paper") {
      context.globalCompositeOperation = "destination-out";
      context.drawImage(this.mask, 0, 0);
      context.globalCompositeOperation = "source-over";
      return;
    }

    context.drawImage(this.mask, 0, 0);
  }
}
