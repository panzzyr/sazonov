import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../src/types";
import { frameCount, normalizeFrameRange, rangeFromSeconds, renderSequence, type ExportSource } from "../src/export/renderSequence";

const mocks = vi.hoisted(() => ({ render: vi.fn(), sample: vi.fn(() => ({ gridW: 1, gridH: 1 })) }));
vi.mock("../src/engine/render", () => ({
  GlyphRenderer: class { render = mocks.render; },
  outputSize: () => ({ width: 16, height: 16, cell: 16 }),
}));
vi.mock("../src/engine/ramp", () => ({ solveRamp: () => [] }));
vi.mock("../src/engine/tone", () => ({
  sampleSource: mocks.sample, gridSize: () => ({ gridW: 1, gridH: 1 }), pitchAspect: () => 1,
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const image = { kind: "image", width: 16, height: 16, bitmap: {} } as ExportSource;

describe("unlimited timelines and absolute export windows", () => {
  it("uses every frame of long videos and stills at 60 fps", () => {
    expect(frameCount({ kind: "video", duration: 3600 } as ExportSource, { ...defaultSettings, targetFps: 60 })).toBe(216000);
    expect(frameCount(image, { ...defaultSettings, stillFrames: 123456 })).toBe(123456);
    expect(() => frameCount({ kind: "video", duration: Infinity } as ExportSource, defaultSettings)).toThrow("finite");
    expect(() => frameCount(image, { ...defaultSettings, stillFrames: Number.MAX_VALUE })).toThrow("finite");
  });

  it("clamps ranges, quantizes seconds, and always includes at least one frame", () => {
    expect(normalizeFrameRange(6000)).toEqual({ start: 0, end: 6000 });
    expect(normalizeFrameRange(6000, { start: -10, end: 7000 })).toEqual({ start: 0, end: 6000 });
    expect(normalizeFrameRange(6000, { start: 9999, end: 1 })).toEqual({ start: 5999, end: 6000 });
    expect(normalizeFrameRange(6000, { start: NaN, end: NaN })).toEqual({ start: 0, end: 6000 });
    expect(rangeFromSeconds(6000, 60, 15, 16)).toEqual({ start: 900, end: 960 });
    expect(rangeFromSeconds(6000, 60, 1 / 60, 3 / 60)).toEqual({ start: 1, end: 3 });
  });

  it("keeps full grid/scatter/blend clocks and reuses one canvas across a trimmed still", async () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    const settings = { ...defaultSettings, stillFrames: 1001, animation: {
      enabled: true, interpolation: "linear" as const, keyframes: [{ at: 0, grid: 200 }, { at: 1, grid: 1 }],
    } };
    const frames = [];
    for await (const frame of renderSequence({ source: image, settings, ink: "flat", library: {} as never,
      signal: new AbortController().signal, range: { start: 999, end: 1001 } })) frames.push(frame);
    expect(frames.map(frame => [frame.index, frame.offset, frame.total, frame.fullTotal])).toEqual([[999, 0, 2, 1001], [1000, 1, 2, 1001]]);
    expect(frames[0].canvas).toBe(frames[1].canvas);
    expect(mocks.sample).toHaveBeenCalledTimes(1);
    expect(mocks.render.mock.calls.map(([options]) => [options.frame, options.loopFrames, options.settings.grid])).toEqual([[999, 1001, 1], [1000, 1001, 1]]);
  });

  it("seeks long video frames on the absolute clock", async () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    const times: number[] = [];
    class Video extends EventTarget {
      readyState = 2;
      get currentTime() { return -1; }
      set currentTime(time: number) { times.push(time); queueMicrotask(() => this.dispatchEvent(new Event("seeked"))); }
    }
    const source = { kind: "video", width: 16, height: 16, duration: 100, video: new Video() } as unknown as ExportSource;
    for await (const _frame of renderSequence({ source, settings: { ...defaultSettings, targetFps: 60 }, ink: "flat",
      library: {} as never, signal: new AbortController().signal, range: { start: 900, end: 902 } })) { /* drain */ }
    expect(times).toEqual([15, 901 / 60]);
    expect(mocks.render.mock.calls[0][0].loopFrames).toBeUndefined();
  });

  it("cancels a stuck seek immediately and removes its listeners", async () => {
    vi.stubGlobal("document", { createElement: () => ({}) });
    const video = Object.assign(new EventTarget(), { currentTime: -1, readyState: 0 });
    const remove = vi.spyOn(video, "removeEventListener");
    const controller = new AbortController();
    const iterator = renderSequence({ source: { kind: "video", width: 16, height: 16, duration: 100, video } as unknown as ExportSource,
      settings: defaultSettings, ink: "flat", library: {} as never, signal: controller.signal });
    const waiting = iterator.next(); controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(remove.mock.calls.map(call => call[0])).toEqual(["seeked", "error"]);
  });
});
