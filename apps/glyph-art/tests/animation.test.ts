import { describe, expect, it } from "vitest";
import { frameProgress, gridAtProgress, referenceGrid, settingsAtFrame } from "../src/animation";
import { defaultSettings, type Settings } from "../src/types";

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
});
