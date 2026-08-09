/**
 * Source raster to a field of per-cell tones.
 *
 * Two gamma decisions here, and both of them are visible in the result.
 *
 * 1. **Downsample in linear light.** Averaging sRGB-encoded values is not
 *    averaging light: a black-and-white checkerboard averages to 128 in
 *    encoded space when the correct answer is 187. Get it wrong and every cell
 *    comes out too dark and the whole picture clogs.
 *
 * 2. **Band in L\*, not in linear.** Equal steps in L* are equal steps to the
 *    eye. Equal steps in linear light put five bands of seven in the shadows.
 *
 * The functions that do arithmetic take plain arrays, so they run in a test
 * without a canvas. Only `sampleSource` touches the DOM.
 */

import type { Range } from "../types";

/** sRGB transfer function, tabulated: this runs once per pixel of every frame. */
const linearTable = (() => {
  const table = new Float32Array(256);
  for (let value = 0; value < 256; value += 1) {
    const channel = value / 255;
    table[value] = channel <= 0.04045
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  }
  return table;
})();

function linearToSrgb(value: number) {
  const clamped = Math.max(0, Math.min(1, value));
  const encoded = clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

/** CIE lightness from linear luminance, normalised to 0..1. */
export function lightness(luminance: number) {
  const y = Math.max(0, Math.min(1, luminance));
  const f = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  return (116 * f - 16) / 100;
}

export type ToneField = {
  gridW: number;
  gridH: number;
  /** Perceptual lightness per cell, 0 is black and 1 is white. */
  tone: Float32Array;
  /** Average source colour per cell as RGB triples, for the colour mode. */
  color: Uint8ClampedArray;
};

/**
 * Box-averages an RGBA buffer down to the cell grid.
 *
 * The buffer is assumed to already match the grid's aspect ratio — cropping
 * happens upstream, in `sampleSource`, where the canvas can do it for free.
 */
export function reduceToCells(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  gridW: number,
  gridH: number,
): ToneField {
  const tone = new Float32Array(gridW * gridH);
  const color = new Uint8ClampedArray(gridW * gridH * 3);

  for (let cellY = 0; cellY < gridH; cellY += 1) {
    const top = Math.floor((cellY * height) / gridH);
    const bottom = Math.max(top + 1, Math.floor(((cellY + 1) * height) / gridH));

    for (let cellX = 0; cellX < gridW; cellX += 1) {
      const left = Math.floor((cellX * width) / gridW);
      const right = Math.max(left + 1, Math.floor(((cellX + 1) * width) / gridW));

      let red = 0;
      let green = 0;
      let blue = 0;
      let samples = 0;

      for (let y = top; y < bottom; y += 1) {
        let offset = (y * width + left) * 4;
        for (let x = left; x < right; x += 1) {
          red += linearTable[pixels[offset]];
          green += linearTable[pixels[offset + 1]];
          blue += linearTable[pixels[offset + 2]];
          offset += 4;
          samples += 1;
        }
      }

      const scale = samples || 1;
      const r = red / scale;
      const g = green / scale;
      const b = blue / scale;
      const index = cellY * gridW + cellX;
      tone[index] = lightness(0.2126 * r + 0.7152 * g + 0.0722 * b);
      color[index * 3] = linearToSrgb(r);
      color[index * 3 + 1] = linearToSrgb(g);
      color[index * 3 + 2] = linearToSrgb(b);
    }
  }

  return { gridW, gridH, tone, color };
}

/**
 * Black and white points from the 1st and 99th percentile of the *cell*
 * tones — the numbers actually being quantized, not the full-resolution
 * pixels. A flat photo quantized into seven bands uses four of them and looks
 * dead, so this runs automatically on load; it is the single biggest lever on
 * whether a first drop looks like anything.
 */
export function autoLevels(tone: Float32Array): Range {
  if (tone.length === 0) return { min: 0, max: 1 };
  const sorted = Float32Array.from(tone).sort();
  const low = sorted[Math.floor(sorted.length * 0.01)];
  const high = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99))];
  // A genuinely flat source should not have its noise amplified into bands.
  if (high - low < 0.15) return { min: 0, max: 1 };
  return { min: low, max: high };
}

/** Applies the levels and returns the band a cell falls into. */
export function bandFor(
  cellTone: number,
  levels: Range,
  bandCount: number,
  rampInvert: boolean,
) {
  const span = Math.max(1e-4, levels.max - levels.min);
  const corrected = Math.max(0, Math.min(1, (cellTone - levels.min) / span));
  // Band 0 is the lightest, so darkness indexes the ramp.
  const darkness = 1 - corrected;
  const index = Math.min(bandCount - 1, Math.max(0, Math.floor(darkness * bandCount)));
  return rampInvert ? bandCount - 1 - index : index;
}

/** Cell grid for a source, derived from its aspect. Cells are always square. */
export function gridSize(grid: number, sourceWidth: number, sourceHeight: number) {
  const across = Math.max(1, Math.round(grid));
  if (sourceWidth <= 0 || sourceHeight <= 0) return { gridW: across, gridH: across };
  return {
    gridW: across,
    gridH: Math.max(1, Math.round((across * sourceHeight) / sourceWidth)),
  };
}

/** Long edge of the intermediate buffer the source is averaged from. */
const workingEdge = 1400;

/**
 * Draws the source into a scratch canvas and reduces it to the cell grid.
 *
 * The scratch buffer is capped rather than full resolution: cell averages do
 * not get more accurate past this point, and a 4K frame would cost tens of
 * milliseconds per frame for nothing. The source is centre-cropped to the
 * grid's aspect, which differs from its own by at most half a cell.
 */
export function sampleSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  gridW: number,
  gridH: number,
  scratch: HTMLCanvasElement,
): ToneField | null {
  const aspect = gridW / gridH;
  const workWidth = Math.max(gridW, Math.min(workingEdge, Math.round(sourceWidth)));
  const workHeight = Math.max(gridH, Math.round(workWidth / aspect));

  scratch.width = workWidth;
  scratch.height = workHeight;
  const context = scratch.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  // Centre-crop the source to the grid aspect rather than stretching it.
  const sourceAspect = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceAspect > aspect) cropWidth = sourceHeight * aspect;
  else cropHeight = sourceWidth / aspect;

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, workWidth, workHeight);
  context.drawImage(
    source,
    (sourceWidth - cropWidth) / 2,
    (sourceHeight - cropHeight) / 2,
    cropWidth,
    cropHeight,
    0,
    0,
    workWidth,
    workHeight,
  );

  const pixels = context.getImageData(0, 0, workWidth, workHeight).data;
  return reduceToCells(pixels, workWidth, workHeight, gridW, gridH);
}
