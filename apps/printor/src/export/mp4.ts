/**
 * MP4 export through WebCodecs.
 *
 * H.264 carries no alpha channel, so the ink passes that key black or white to
 * transparency are PNG-only; MP4 always writes the flat grayscale result. The
 * muxer runs entirely in memory — nothing is uploaded.
 */

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { renderSequence, type SequenceOptions } from "./renderSequence";

/** Tried in order; the first the browser accepts for this size wins. */
const codecCandidates = ["avc1.640034", "avc1.640028", "avc1.4d0034", "avc1.42003e"];

export function canEncodeMp4() {
  return typeof globalThis.VideoEncoder === "function" && typeof globalThis.VideoFrame === "function";
}

async function chooseCodec(width: number, height: number, framerate: number) {
  for (const codec of codecCandidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec, width, height, framerate });
      if (support.supported) return codec;
    } catch {
      // Malformed codec strings throw rather than reporting unsupported.
    }
  }
  return null;
}

export type Mp4ExportOptions = Omit<SequenceOptions, "ink" | "width" | "height"> & {
  width: number;
  height: number;
  onProgress: (completed: number, total: number) => void;
};

export async function exportMp4(options: Mp4ExportOptions) {
  if (!canEncodeMp4()) {
    throw new Error("This browser cannot encode MP4. Export a PNG sequence instead.");
  }

  // H.264 requires even dimensions.
  const width = Math.max(2, Math.round(options.width / 2) * 2);
  const height = Math.max(2, Math.round(options.height / 2) * 2);
  const framerate = options.settings.targetFps;

  const codec = await chooseCodec(width, height, framerate);
  if (!codec) {
    throw new Error(`No supported H.264 profile for ${width}×${height}. Export a PNG sequence instead.`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failure = error instanceof Error ? error : new Error(String(error));
    },
  });

  // Grain and threshold noise are worst-case content for an encoder, so the
  // bitrate is deliberately generous; a print look falls apart under blocking.
  const bitrate = Math.round(width * height * framerate * 0.25);
  encoder.configure({ codec, width, height, framerate, bitrate, latencyMode: "quality" });

  const microsecondsPerFrame = 1_000_000 / framerate;

  try {
    for await (const frame of renderSequence({ ...options, width, height, ink: "flat" })) {
      if (failure) throw failure;
      const videoFrame = new VideoFrame(frame.canvas, {
        timestamp: Math.round(frame.index * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame),
      });
      // A keyframe every two seconds keeps the file seekable in editors.
      encoder.encode(videoFrame, { keyFrame: frame.index % Math.max(1, framerate * 2) === 0 });
      videoFrame.close();
      options.onProgress(frame.index + 1, frame.total);

      // Encoding is async; letting the queue run away burns memory on long clips.
      while (encoder.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 4));
        if (failure) throw failure;
      }
    }

    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: "video/mp4" });
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}
