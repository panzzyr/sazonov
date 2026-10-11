/**
 * Frame-stepping shared by every export path.
 *
 * Time posterization happens here: frame N is whatever the source shows at
 * N / targetFps seconds, so a 24 fps clip exported at 8 fps holds each frame
 * for three source frames instead of interpolating. The preview steps the same
 * way, so what you scrub through is what you get.
 *
 * A still is sampled once. Its tone field never changes, which means a still
 * can animate through symbol cycling or grid keyframes. Infinite hold freezes
 * only the former; it never shortens the sequence or stops the grid timeline.
 */

import { GlyphRenderer, outputSize } from "../engine/render";
import { HalftoneRenderer } from "../engine/halftone";
import { GlyphLibrary } from "../engine/glyphLibrary";
import { solveRamp } from "../engine/ramp";
import { gridSize, pitchAspect, sampleSource, type ToneField } from "../engine/tone";
import { referenceGrid, settingsAtFrame } from "../animation";
import {
  halftoneSize,
  type ExportInk,
  type Settings,
} from "../types";

export type ExportSource =
  | { kind: "video"; video: HTMLVideoElement; width: number; height: number; duration: number }
  | { kind: "image"; bitmap: ImageBitmap; width: number; height: number };

/**
 * A video is as long as its duration at the target rate. A still has no
 * duration, so the length is whatever the user asked for.
 */
export function frameCount(source: ExportSource, settings: Settings) {
  const requested = source.kind === "image"
    ? Math.round(settings.stillFrames)
    : Math.ceil(source.duration * settings.targetFps);
  if (!Number.isFinite(requested) || requested > Number.MAX_SAFE_INTEGER) {
    throw new Error("The source does not have a finite, usable duration.");
  }
  return Math.max(1, requested);
}

/** Absolute frame indices, end exclusive. Trimming never restarts the artwork's clocks. */
export type FrameRange = { start: number; end: number };

export function normalizeFrameRange(total: number, range?: FrameRange): FrameRange {
  const start = Math.max(0, Math.min(total - 1, Math.floor(Number.isFinite(range?.start) ? range!.start : 0)));
  const end = Math.max(start + 1, Math.min(total, Math.ceil(Number.isFinite(range?.end) ? range!.end : total)));
  return { start, end };
}

export function rangeFromSeconds(total: number, fps: number, start: number, end: number) {
  return normalizeFrameRange(total, { start: Math.ceil(start * fps - 1e-7), end: Math.ceil(end * fps - 1e-7) });
}

/**
 * Cells the source is averaged into before a halftone screen reads it.
 *
 * A dot samples the picture at its own centre. Keep the usual quarter-frame
 * field, but give a dense screen at least two samples per pitch so raising the
 * ruling does not just oversample the old, coarser tone field. The 1024 cap
 * bounds the intermediate allocation independently of export resolution.
 */
export function halftoneField(settings: Settings, sourceWidth: number, sourceHeight: number) {
  const frame = halftoneSize(settings.outputWidth, sourceWidth, sourceHeight);
  const across = Math.min(1024, Math.max(Math.round(frame.width / 4), settings.halftone.lines * 2));
  return gridSize(across, sourceWidth, sourceHeight);
}

/** The raster every export path will produce, known before a frame is drawn. */
export function sequenceSize(source: ExportSource, settings: Settings) {
  if (settings.mode === "halftone") {
    const { gridW, gridH } = halftoneField(settings, source.width, source.height);
    const frame = halftoneSize(settings.outputWidth, source.width, source.height);
    return { gridW, gridH, cell: 0, width: frame.width, height: frame.height };
  }
  const { gridW, gridH } = gridSize(referenceGrid(settings), source.width, source.height, settings.spacing);
  const { cell, width, height } = outputSize(settings, { gridW, gridH });
  return { gridW, gridH, cell, width, height };
}

function seek(video: HTMLVideoElement, time: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("The browser could not decode a requested video frame."));
    };
    const onAbort = () => { cleanup(); reject(new DOMException("Export cancelled.", "AbortError")); };
    const timer = setTimeout(onError, 15_000);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
    try { video.currentTime = time; }
    catch (error) { cleanup(); reject(error); }
  });
}

export type SequenceOptions = {
  source: ExportSource;
  settings: Settings;
  ink: ExportInk;
  library: GlyphLibrary;
  signal: AbortSignal;
  range?: FrameRange;
  /** Halftone only: render this separation alone, as a printing plate. */
  plate?: number;
};

export type RenderedFrame = {
  canvas: HTMLCanvasElement;
  index: number;
  total: number;
  /** Position inside the selected export, for zero-based MP4 timestamps. */
  offset: number;
  fullTotal: number;
};

/**
 * Yields each rendered frame on a private canvas. The canvas is reused between
 * frames, so consumers must encode it before requesting the next one.
 */
export async function* renderSequence(options: SequenceOptions): AsyncGenerator<RenderedFrame> {
  const { source, settings, ink, library, signal, plate } = options;
  const fullTotal = frameCount(source, settings);
  const range = normalizeFrameRange(fullTotal, options.range);
  const total = range.end - range.start;
  const frame = sequenceSize(source, settings);
  const canvas = document.createElement("canvas");
  const scratch = document.createElement("canvas");
  const halftoning = settings.mode === "halftone";
  const renderer = halftoning ? new HalftoneRenderer(canvas) : new GlyphRenderer(canvas);
  // The ramp depends only on the settings, so it is solved once for the run.
  const ramp = halftoning ? [] : solveRamp(settings, library.metrics);
  const cellAspect = halftoning ? 1 : pitchAspect(settings.spacing);
  let field: ToneField | null = null;
  let sampledGrid = "";

  for (let index = range.start; index < range.end; index += 1) {
    if (signal.aborted) throw new DOMException("Export cancelled.", "AbortError");

    const frameSettings = settingsAtFrame(settings, index, fullTotal);
    const { gridW, gridH } = frameSettings.mode === "halftone"
      ? halftoneField(frameSettings, source.width, source.height)
      : gridSize(frameSettings.grid, source.width, source.height, frameSettings.spacing);

    if (source.kind === "video") {
      await seek(source.video, Math.min(source.duration, index / settings.targetFps), signal);
      field = sampleSource(source.video, source.width, source.height, gridW, gridH, scratch, cellAspect);
    } else if (sampledGrid !== `${gridW}x${gridH}`) {
      field = sampleSource(source.bitmap, source.width, source.height, gridW, gridH, scratch, cellAspect);
      sampledGrid = `${gridW}x${gridH}`;
    }
    if (!field) throw new Error("The source could not be sampled onto the grid.");

    if (renderer instanceof HalftoneRenderer) {
      renderer.render({ settings: frameSettings, field, ink, plate, frame });
    } else {
      renderer.render({
        settings: frameSettings,
        field,
        library,
        frame: index,
        loopFrames: source.kind === "image" ? fullTotal : undefined,
        ink,
        ramp,
        size: frame,
      });
    }
    yield { canvas, index, total, fullTotal, offset: index - range.start };
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
