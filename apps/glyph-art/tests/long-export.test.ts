import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { defaultSettings } from "../src/types";
import { exportMp4, mp4PartBytes, mp4PartFrames } from "../src/export/mp4";
import { exportPngSequence } from "../src/export/pngSequence";
import { FileOutput } from "../src/export/fileOutput";
import type { ExportSource } from "../src/export/renderSequence";

const mock = vi.hoisted(() => ({ frames: [] as { timestamp: number; duration: number; closed: boolean }[],
  encoders: [] as { state: string }[], byteLength: 1, targets: [] as object[] }));
vi.mock("../src/export/renderSequence", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/export/renderSequence")>();
  return { ...actual, sequenceSize: () => ({ width: 16, height: 16 }),
    renderSequence: async function* (options: Parameters<typeof actual.renderSequence>[0]) {
      const fullTotal = actual.frameCount(options.source, options.settings);
      const { start, end } = actual.normalizeFrameRange(fullTotal, options.range);
      for (let index = start; index < end; index++) {
        options.signal.throwIfAborted();
        const canvas = { toBlob: (callback: BlobCallback) => callback(new Blob([`${options.ink}:${index}`])) } as HTMLCanvasElement;
        yield { canvas, index, offset: index - start, total: end - start, fullTotal };
      }
    } };
});
vi.mock("mp4-muxer", () => {
  class ArrayBufferTarget { buffer = new ArrayBuffer(1); constructor() { mock.targets.push(this); } }
  class StreamTarget { constructor(public options: { onData: (data: Uint8Array, position: number) => void }) { mock.targets.push(this); } }
  return { ArrayBufferTarget, StreamTarget, Muxer: class {
    target: ArrayBufferTarget | StreamTarget;
    constructor(options: { target: ArrayBufferTarget | StreamTarget }) { this.target = options.target; }
    addVideoChunk() { if (this.target instanceof StreamTarget) this.target.options.onData(new Uint8Array([1]), 0); }
    finalize() {}
  } };
});
beforeEach(() => {
  mock.frames.length = mock.encoders.length = mock.targets.length = 0; mock.byteLength = 1;
  vi.stubGlobal("VideoFrame", class {
    timestamp: number; duration: number; closed = false;
    constructor(_canvas: unknown, init: { timestamp: number; duration: number }) {
      this.timestamp = init.timestamp; this.duration = init.duration; mock.frames.push(this);
    }
    close() { this.closed = true; }
  });
  vi.stubGlobal("VideoEncoder", class {
    static async isConfigSupported() { return { supported: true }; }
    state = "unconfigured"; encodeQueueSize = 0;
    constructor(private options: { output: (chunk: { byteLength: number }) => void }) { mock.encoders.push(this); }
    configure() { this.state = "configured"; }
    encode() { this.options.output({ byteLength: mock.byteLength }); }
    async flush() {} close() { this.state = "closed"; }
  });
});
afterEach(() => vi.unstubAllGlobals());
const options = () => ({ source: { kind: "image", width: 16, height: 16 } as ExportSource,
  settings: { ...defaultSettings, targetFps: 60, stillFrames: 1001 }, library: {} as never,
  signal: new AbortController().signal, range: { start: 900, end: 903 }, onProgress: vi.fn() });

describe("long MP4 output", () => {
  it("exports beyond the old cap with zero-based container timestamps", async () => {
    const onPart = vi.fn(); const opts = options();
    expect(await exportMp4({ ...opts, onPart })).toBe(1);
    expect(mock.frames.map(frame => frame.timestamp)).toEqual([0, 16667, 33333]);
    expect(mock.frames.every(frame => frame.closed)).toBe(true);
    expect(mock.encoders.every(encoder => encoder.state === "closed")).toBe(true);
    expect(opts.onProgress).toHaveBeenLastCalledWith(3, 3);
    expect(onPart).toHaveBeenCalledOnce();
  });
  it("splits downloads at the byte budget without dropping boundary frames", async () => {
    mock.byteLength = mp4PartBytes; const onPart = vi.fn();
    expect(await exportMp4({ ...options(), onPart })).toBe(3);
    expect(onPart.mock.calls.map(call => call[1])).toEqual([1, 2, 3]);
    expect(mock.frames.map(frame => frame.timestamp)).toEqual([0, 0, 0]);
    expect(mp4PartFrames(4096, 4096)).toBeLessThan(100);
    expect(mp4PartFrames(16, 16)).toBe(10000);
  });
  it("streams one movie even when downloads would have split", async () => {
    mock.byteLength = mp4PartBytes;
    const stream = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    const onPart = vi.fn();
    expect(await exportMp4({ ...options(), onPart, output: new FileOutput(stream) })).toBe(1);
    expect(mock.targets).toHaveLength(1); expect(stream.write).toHaveBeenCalledTimes(3);
    expect(stream.close).toHaveBeenCalledOnce(); expect(stream.abort).not.toHaveBeenCalled();
    expect(onPart).not.toHaveBeenCalled();
  });
  it("discards unfinished disk output and closes the encoder on cancellation", async () => {
    const controller = new AbortController();
    const stream = { write: vi.fn(async () => {}), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    await expect(exportMp4({ ...options(), signal: controller.signal, onProgress: () => controller.abort(),
      onPart: vi.fn(), output: new FileOutput(stream) })).rejects.toMatchObject({ name: "AbortError" });
    expect(stream.abort).toHaveBeenCalledOnce(); expect(stream.close).not.toHaveBeenCalled();
    expect(mock.encoders.every(encoder => encoder.state === "closed")).toBe(true);
  });
  it("surfaces disk errors without leaking the encoder", async () => {
    const stream = { write: vi.fn(async () => { throw new Error("Disk full"); }), close: vi.fn(async () => {}), abort: vi.fn(async () => {}) };
    await expect(exportMp4({ ...options(), onPart: vi.fn(), output: new FileOutput(stream) })).rejects.toThrow("Disk full");
    expect(stream.abort).toHaveBeenCalledOnce(); expect(stream.close).not.toHaveBeenCalled();
    expect(mock.encoders.every(encoder => encoder.state === "closed")).toBe(true);
  });
});

describe("long PNG output", () => {
  it("preserves absolute filenames and every alpha pass in a trimmed sequence", async () => {
    const files: ReturnType<typeof unzipSync>[] = []; const opts = options();
    const count = await exportPngSequence({ ...opts, inks: ["flat", "ink", "paper"], separations: false, basename: "source.png",
      onArchive: async blob => { files.push(unzipSync(new Uint8Array(await blob.arrayBuffer()))); } });
    expect(count).toBe(1);
    expect(Object.keys(files[0]).filter(name => name.endsWith(".png"))).toEqual(
      ["flat", "ink", "paper"].flatMap(pass => [900, 901, 902].map(index => `${pass}/source-${String(index).padStart(4, "0")}.png`)));
    expect(new TextDecoder().decode(files[0]["ink/source-0901.png"])).toBe("ink:901");
    const readme = new TextDecoder().decode(files[0]["README.txt"]);
    expect(readme).toContain("full timeline frames: 1001"); expect(readme).toContain("source frame range: 900..902");
    expect(opts.onProgress).toHaveBeenLastCalledWith(9, 9);
  });
  it("pads names for timelines longer than 9999 frames", async () => {
    const files: ReturnType<typeof unzipSync>[] = [];
    await exportPngSequence({ ...options(), settings: { ...defaultSettings, stillFrames: 10001 }, range: { start: 9999, end: 10001 },
      inks: ["flat"], separations: false, basename: "clip", onArchive: async blob => { files.push(unzipSync(new Uint8Array(await blob.arrayBuffer()))); } });
    expect(Object.keys(files[0]).filter(name => name.endsWith(".png"))).toEqual(["clip-09999.png", "clip-10000.png"]);
  });
});
