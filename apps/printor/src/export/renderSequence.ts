/**
 * Frame-stepping shared by every export path.
 *
 * Time posterization happens here: frame N is whatever the source shows at
 * N / targetFps seconds, so a 24 fps clip exported at 8 fps holds each frame
 * for three source frames instead of interpolating. The preview steps the same
 * way, so what you scrub through is what you get.
 */

import { Renderer } from "../engine/Renderer";
import { resolveFrame } from "../engine/frameParams";
import { TextureCache } from "../engine/textureCache";
import { maxExportFrames, textureStages, type ExportInk, type Settings } from "../types";

export type ExportSource =
  | { kind: "video"; video: HTMLVideoElement; duration: number }
  | { kind: "image"; bitmap: ImageBitmap };

export const MAX_EXPORT_FRAMES = maxExportFrames;

/**
 * A video is as long as its duration at the target rate. A still has no
 * duration, so the length is whatever the user asked for — each frame differs
 * because the parameters are redrawn, not because the source moved.
 */
export function frameCount(source: ExportSource, settings: Settings) {
  const requested = source.kind === "image"
    ? Math.round(settings.stillFrames)
    : Math.ceil(source.duration * settings.targetFps);
  return Math.min(maxExportFrames, Math.max(1, requested));
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
  width: number;
  height: number;
  settings: Settings;
  ink: ExportInk;
  cache: TextureCache;
  signal: AbortSignal;
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
  const { source, settings, ink, cache, signal } = options;
  const total = frameCount(source, settings);

  const canvas = document.createElement("canvas");
  canvas.width = options.width;
  canvas.height = options.height;
  const renderer = new Renderer(canvas);

  try {
    for (let index = 0; index < total; index += 1) {
      if (signal.aborted) throw new DOMException("Export cancelled.", "AbortError");

      const params = resolveFrame(settings, index);

      // Load only what this frame needs, then bind it. The renderer skips the
      // upload when the same texture is already resident.
      for (const stage of textureStages) {
        const id = params[stage].textureId;
        if (!params.active[stage] || !id) continue;
        const image = await cache.load(id);
        if (image) renderer.setStageTexture(stage, image, id);
      }

      if (source.kind === "video") {
        await seek(source.video, Math.min(source.duration, index / settings.targetFps));
        renderer.render(source.video, params, { ink, invert: settings.invert, bypass: false });
      } else {
        renderer.render(source.bitmap, params, { ink, invert: settings.invert, bypass: false });
      }

      yield { canvas, index, total };
    }
  } finally {
    renderer.dispose();
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
