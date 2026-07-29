import { strToU8, zipSync, type Zippable } from "fflate";
import { Renderer } from "../engine/Renderer";
import type { EffectLayer, Settings } from "../types";

type ExportSource =
  | { kind: "image"; bitmap: ImageBitmap }
  | { kind: "video"; video: HTMLVideoElement; duration: number };

type ExportOptions = {
  source: ExportSource;
  width: number;
  height: number;
  basename: string;
  settings: Settings;
  layers: EffectLayer[];
  signal: AbortSignal;
  onProgress: (completed: number, total: number) => void;
};

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode this frame as PNG."));
    }, "image/png");
  });
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

function safeName(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "printor";
}

export async function exportPngSequence(options: ExportOptions) {
  const canvas = document.createElement("canvas");
  const renderer = new Renderer(canvas);
  renderer.resize(options.width, options.height);
  const files: Zippable = {};
  const frameCount = options.source.kind === "video"
    ? Math.min(300, Math.max(1, Math.ceil(options.source.duration * options.settings.targetFps)))
    : 1;
  const originalTime = options.source.kind === "video" ? options.source.video.currentTime : 0;
  const prefix = safeName(options.basename);

  try {
    for (let frame = 0; frame < frameCount; frame += 1) {
      options.signal.throwIfAborted();
      let source: TexImageSource;
      if (options.source.kind === "video") {
        const time = Math.min(
          Math.max(0, options.source.duration - 0.001),
          frame / options.settings.targetFps,
        );
        await seek(options.source.video, time);
        source = options.source.video;
      } else {
        source = options.source.bitmap;
      }

      renderer.render(source, options.settings, options.layers, frame);
      const blob = await canvasBlob(canvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      files[`${prefix}-${String(frame + 1).padStart(4, "0")}.png`] = bytes;
      options.onProgress(frame + 1, frameCount);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  } finally {
    if (options.source.kind === "video") {
      await seek(options.source.video, originalTime).catch(() => undefined);
    }
  }

  options.signal.throwIfAborted();
  files["printor.json"] = strToU8(JSON.stringify({
    version: 1,
    settings: options.settings,
    layers: options.layers,
    source: { width: options.width, height: options.height, frames: frameCount },
  }, null, 2));
  return new Blob([zipSync(files, { level: 0 })], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
