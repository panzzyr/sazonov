/**
 * Frame-stepping shared by every export path.
 *
 * Time posterization happens here: frame N is whatever the source shows at
 * N / targetFps seconds, so a 24 fps clip exported at 8 fps holds each frame
 * for three source frames instead of interpolating. The preview steps the same
 * way, so what you scrub through is what you get.
 *
 * A still is sampled once. Its tone field never changes, which means a still
 * only animates if a band holds more than one mark — an honest answer, and the
 * reason the tool is static until you ask it not to be.
 */

import { GlyphRenderer, outputSize } from "../engine/render";
import { HalftoneRenderer } from "../engine/halftone";
import { GlyphLibrary } from "../engine/glyphLibrary";
import { solveRamp } from "../engine/ramp";
import { gridSize, sampleSource, type ToneField } from "../engine/tone";
import {
  cellPixels,
  halftoneSize,
  maxExportFrames,
  type ExportInk,
  type Settings,
} from "../types";

export type ExportSource =
  | { kind: "video"; video: HTMLVideoElement; width: number; height: number; duration: number }
  | { kind: "image"; bitmap: ImageBitmap; width: number; height: number };

export const MAX_EXPORT_FRAMES = maxExportFrames;

/**
 * A video is as long as its duration at the target rate. A still has no
 * duration, so the length is whatever the user asked for.
 */
export function frameCount(source: ExportSource, settings: Settings) {
  const requested = source.kind === "image"
    ? Math.round(settings.stillFrames)
    : Math.ceil(source.duration * settings.targetFps);
  return Math.min(maxExportFrames, Math.max(1, requested));
}

/**
 * Cells the source is averaged into before a halftone screen reads it.
 *
 * Independent of the ruling on purpose. A dot samples the picture at its own
 * centre, so the field only has to be fine enough that the dots are reading an
 * image rather than a mosaic — roughly a quarter of the frame, which is finer
 * than any ruling the tool offers and cheap next to drawing the dots.
 */
export function halftoneField(settings: Settings, sourceWidth: number, sourceHeight: number) {
  const frame = halftoneSize(settings.halftone.width, sourceWidth, sourceHeight);
  return gridSize(Math.min(640, Math.round(frame.width / 4)), sourceWidth, sourceHeight);
}

/** The raster every export path will produce, known before a frame is drawn. */
export function sequenceSize(source: ExportSource, settings: Settings) {
  if (settings.mode === "halftone") {
    const { gridW, gridH } = halftoneField(settings, source.width, source.height);
    const frame = halftoneSize(settings.halftone.width, source.width, source.height);
    return { gridW, gridH, cell: 0, width: frame.width, height: frame.height };
  }
  const { gridW, gridH } = gridSize(settings.grid, source.width, source.height);
  const cell = cellPixels(settings.grid);
  return { gridW, gridH, cell, width: gridW * cell, height: gridH * cell };
}

function seek(video: HTMLVideoElement, time: number) {
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode a requested video frame."));
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.currentTime = time;
  });
}

export type SequenceOptions = {
  source: ExportSource;
  settings: Settings;
  ink: ExportInk;
  library: GlyphLibrary;
  signal: AbortSignal;
  /** Halftone only: render this separation alone, as a printing plate. */
  plate?: number;
};

export type RenderedFrame = {
  canvas: HTMLCanvasElement;
  index: number;
  total: number;
};

/**
 * Yields each rendered frame on a private canvas. The canvas is reused between
 * frames, so consumers must encode it before requesting the next one.
 */
export async function* renderSequence(options: SequenceOptions): AsyncGenerator<RenderedFrame> {
  const { source, settings, ink, library, signal, plate } = options;
  const total = frameCount(source, settings);
  const { gridW, gridH } = sequenceSize(source, settings);

  const frame = sequenceSize(source, settings);
  const canvas = document.createElement("canvas");
  const scratch = document.createElement("canvas");
  const halftoning = settings.mode === "halftone";
  const renderer = halftoning ? new HalftoneRenderer(canvas) : new GlyphRenderer(canvas);
  // The ramp depends only on the settings, so it is solved once for the run.
  const ramp = halftoning ? [] : solveRamp(settings, library.metrics);

  let field: ToneField | null = source.kind === "image"
    ? sampleSource(source.bitmap, source.width, source.height, gridW, gridH, scratch)
    : null;

  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) throw new DOMException("Export cancelled.", "AbortError");

    if (source.kind === "video") {
      await seek(source.video, Math.min(source.duration, index / settings.targetFps));
      field = sampleSource(source.video, source.width, source.height, gridW, gridH, scratch);
    }
    if (!field) throw new Error("The source could not be sampled onto the grid.");

    if (renderer instanceof HalftoneRenderer) renderer.render({ settings, field, ink, plate, frame });
    else renderer.render({ settings, field, library, frame: index, ink, ramp });
    yield { canvas, index, total };
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking immediately can race the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export { outputSize };
