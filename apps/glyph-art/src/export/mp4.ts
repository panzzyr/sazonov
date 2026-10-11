/**
 * MP4 export through WebCodecs.
 *
 * H.264 carries no alpha channel, so the passes that key the paper or the
 * marks to transparency are PNG-only; MP4 always writes the flat result. The
 * MP4 can stream to a chosen local file. Download fallback uses bounded parts;
 * nothing is uploaded, and artwork clocks always use absolute source indices.
 *
 * The frame is never resized here. `outputFrameSize` guarantees an even raster,
 * which is H.264's dimensional requirement, so preview and export still agree.
 */

import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";
import { renderSequence, sequenceSize, type SequenceOptions } from "./renderSequence";
import type { FileOutput } from "./fileOutput";

export const mp4PartBytes = 64 * 1024 * 1024;
/** Conservative VBR headroom; an actual encoded-byte threshold also closes each part. */
export function mp4PartFrames(width: number, height: number) {
  return Math.max(1, Math.min(10000, Math.floor(mp4PartBytes / Math.max(1, width * height * 0.25 / 8 * 2))));
}

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

export type Mp4ExportOptions = Omit<SequenceOptions, "ink"> & {
  onProgress: (completed: number, total: number) => void;
  output?: FileOutput;
  onPart: (blob: Blob, part: number) => void | Promise<void>;
};

export async function exportMp4(options: Mp4ExportOptions) {
  let encoder: VideoEncoder | null = null;
  let failure: Error | null = null;
  try {
    if (!canEncodeMp4()) throw new Error("This browser cannot encode MP4. Export a PNG sequence instead.");
    const { width, height } = sequenceSize(options.source, options.settings);
    const framerate = options.settings.targetFps;
    const codec = await chooseCodec(width, height, framerate);
    if (!codec) throw new Error(`No supported H.264 profile for ${width}×${height}. Export a PNG sequence instead.`);
    const bitrate = Math.round(width * height * framerate * 0.25);
    const frameBudget = mp4PartFrames(width, height);
    const microsecondsPerFrame = 1_000_000 / framerate;
    let parts = 0;
    const startPart = (first: number) => {
      const target = options.output ? new StreamTarget({ chunked: true, chunkSize: 1024 * 1024,
        onData: (data, position) => options.output!.write(data, position) }) : new ArrayBufferTarget();
      // Standard MP4 with moov at the end: stream media immediately, not an
      // entire in-memory fast-start movie or a less compatible fragmented MP4.
      const muxer = new Muxer({ target, video: { codec: "avc", width, height }, fastStart: false });
      const part = { first, frames: 0, bytes: 0, muxer };
      encoder = new VideoEncoder({
        output: (chunk, meta) => {
          try { part.muxer.addVideoChunk(chunk, meta); part.bytes += chunk.byteLength; }
          catch (error) { failure = error instanceof Error ? error : new Error(String(error)); }
        },
        error: (error) => { failure = error instanceof Error ? error : new Error(String(error)); },
      });
      encoder.configure({ codec, width, height, framerate, bitrate, latencyMode: "quality" });
      return part;
    };
    let part: ReturnType<typeof startPart> | null = null;
    const finishPart = async () => {
      if (!part || !encoder) return;
      await encoder.flush();
      options.signal.throwIfAborted();
      if (failure) throw failure;
      part.muxer.finalize();
      encoder.close();
      encoder = null;
      parts++;
      if (options.output) await options.output.flush();
      else if (part.muxer.target instanceof ArrayBufferTarget) {
        const blob = new Blob([part.muxer.target.buffer], { type: "video/mp4" });
        part = null;
        await options.onPart(blob, parts);
      }
      part = null;
    };

    for await (const frame of renderSequence({ ...options, ink: "flat" })) {
      if (!part) part = startPart(frame.index);
      if (failure) throw failure;
      const videoFrame = new VideoFrame(frame.canvas, {
        timestamp: Math.round((frame.index - part.first) * microsecondsPerFrame),
        duration: Math.round(microsecondsPerFrame),
      });
      try { encoder!.encode(videoFrame, { keyFrame: part.frames % Math.max(1, framerate * 2) === 0 }); }
      finally { videoFrame.close(); }
      part.frames++;
      options.onProgress(frame.offset + 1, frame.total);

      while (encoder!.encodeQueueSize > 8) {
        await new Promise((resolve) => setTimeout(resolve, 4));
        options.signal.throwIfAborted();
        if (failure) throw failure;
      }
      // The filesystem queue must be bounded as well as the codec queue.
      if (options.output && options.output.pendingBytes >= 4 * 1024 * 1024) await options.output.flush();
      if (!options.output && (part.frames >= frameBudget || part.bytes >= mp4PartBytes)) await finishPart();
      // An unchanged still otherwise feeds thousands of frames without yielding.
      if (frame.offset % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await finishPart();
    options.signal.throwIfAborted();
    await options.output?.close();
    return parts;
  } catch (error) {
    await options.output?.abort().catch(() => {});
    throw error;
  } finally {
    // The encoder is assigned in startPart's callback; TS cannot follow that assignment.
    const active = encoder as VideoEncoder | null;
    if (active && active.state !== "closed") active.close();
  }
}
