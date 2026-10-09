import { describe, expect, it } from "vitest";
import { frameProgress, gridAtProgress, referenceGrid, settingsAtFrame } from "../src/animation";
import { defaultSettings, maxGrid, type Settings } from "../src/types";
import { frameCount, type ExportSource } from "../src/export/renderSequence";

function animated(interpolation: Settings["animation"]["interpolation"] = "linear"): Settings {
  return {
    ...defaultSettings,
    animation: {
      enabled: true,
      interpolation,
      keyframes: [
        { at: 0, grid: 200 },
        { at: 0.5, grid: 1 },
        { at: 1, grid: 200 },
      ],
    },
  };
}

describe("grid keyframes", () => {
  it("keeps grid motion and output duration active at 60 fps with frozen symbols", () => {
    const settings = { ...animated(), targetFps: 60, hold: "infinite" as const, stillFrames: 240 };
    const source = { kind: "image" } as ExportSource;
    expect(frameCount(source, settings)).toBe(240);
    expect(settingsAtFrame(settings, 0, 241).grid).toBe(200);
    expect(settingsAtFrame(settings, 120, 241).grid).toBe(1);
    expect(settingsAtFrame(settings, 240, 241).grid).toBe(200);
    expect(settingsAtFrame(settings, 120, 241).hold).toBe("infinite");
    expect(frameCount({ kind: "video", duration: 2 } as ExportSource, settings)).toBe(120);
    expect(frameCount({ kind: "video", duration: 100 } as ExportSource, settings)).toBe(900);
  });
  it("reaches the exact first, middle and last keyframes", () => {
    const settings = animated();
    expect(gridAtProgress(settings, 0)).toBe(200);
    expect(gridAtProgress(settings, 0.5)).toBe(1);
    expect(gridAtProgress(settings, 1)).toBe(200);
  });

  it("interpolates linearly between keyframes", () => {
    const settings = animated("linear");
    expect(gridAtProgress(settings, 0.25)).toBe(101);
    expect(gridAtProgress(settings, 0.75)).toBe(101);
  });

  it("holds the previous value until the next keyframe", () => {
    const settings = animated("hold");
    expect(gridAtProgress(settings, 0.49)).toBe(200);
    expect(gridAtProgress(settings, 0.5)).toBe(1);
    expect(gridAtProgress(settings, 0.99)).toBe(1);
    expect(gridAtProgress(settings, 1)).toBe(200);
  });

  it("maps the last frame to progress one without an off-by-one", () => {
    expect(frameProgress(0, 25)).toBe(0);
    expect(frameProgress(24, 25)).toBe(1);
    expect(settingsAtFrame(animated(), 12, 25).grid).toBe(1);
  });

  it("leaves static and halftone projects alone", () => {
    expect(gridAtProgress(defaultSettings, 0.5)).toBe(defaultSettings.grid);
    expect(gridAtProgress({ ...animated(), mode: "halftone" }, 0.5)).toBe(defaultSettings.grid);
  });

  it("uses the densest keyframe to establish a stable export frame", () => {
    expect(referenceGrid(animated())).toBe(200);
  });

  it("animates the expanded maximum through intermediate grids without the old ceiling", () => {
    const settings = animated();
    settings.animation.keyframes = [{ at: 0, grid: maxGrid }, { at: 1, grid: 1 }];
    expect(gridAtProgress(settings, 0)).toBe(512);
    expect(gridAtProgress(settings, 0.5)).toBe(257);
    expect(gridAtProgress(settings, 1)).toBe(1);
    expect(referenceGrid(settings)).toBe(512);
  });
});
