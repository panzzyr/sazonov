import { describe, expect, it } from "vitest";
import { symbolFrame } from "../src/engine/symbolMotion";
import { cycleIndex } from "../src/engine/cellParams";
import { initialSettings } from "../src/store";
import type { Settings } from "../src/types";

function scatter(): Settings {
  return { ...initialSettings(), targetFps: 60,
    symbolMotion: { mode: "scatter", loop: false, amount: 10, interval: 250 } };
}

describe("independent symbol clocks", () => {
  it("preserves classic cycling and the seeded initial image", () => {
    const settings = initialSettings();
    for (const frame of [0, 1, 50, 899]) {
      expect(symbolFrame(settings, 42, frame)).toEqual({ frame, hold: settings.hold });
    }
    for (let cell = 0; cell < 100; cell++) {
      const clock = symbolFrame(scatter(), cell, 0);
      expect(cycleIndex(8471, cell, 33, clock.frame, clock.hold))
        .toBe(cycleIndex(8471, cell, 33, 0, 2));
    }
  });

  it("schedules approximately the requested percentage, spread over frames", () => {
    const settings = scatter();
    const events = Array.from({ length: 15 }, () => 0);
    for (let cell = 0; cell < 10000; cell++) {
      for (let frame = 1; frame <= 15; frame++) {
        events[frame - 1] += symbolFrame(settings, cell, frame).frame
          - symbolFrame(settings, cell, frame - 1).frame;
      }
    }
    const total = events.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(900);
    expect(total).toBeLessThan(1100);
    expect(Math.min(...events)).toBeGreaterThan(30);
    expect(Math.max(...events)).toBeLessThan(110);
  });

  it("uses fresh spatial masks, not a fixed repeating group of cells", () => {
    const settings = scatter();
    const changed = (start: number) => Array.from({ length: 2000 }, (_, cell) => cell)
      .filter(cell => symbolFrame(settings, cell, start).frame !== symbolFrame(settings, cell, start + 15).frame);
    expect(changed(0)).not.toEqual(changed(150));
    expect(changed(0)).not.toEqual(changed(15));
  });

  it("is monotonic across block boundaries and independent of seek order", () => {
    const settings = scatter();
    for (let cell = 0; cell < 50; cell++) {
      let previous = 0;
      const forward = Array.from({ length: 901 }, (_, frame) => {
        const value = symbolFrame(settings, cell, frame).frame;
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value - previous).toBeLessThanOrEqual(1);
        previous = value;
        return value;
      });
      for (const frame of [900, 149, 150, 151, 2, 500, 0]) {
        expect(symbolFrame(settings, cell, frame).frame).toBe(forward[frame]);
      }
    }
  });

  it("measures time in milliseconds, independent of output FPS", () => {
    const settings = scatter();
    for (let cell = 0; cell < 100; cell++) {
      expect(symbolFrame(settings, cell, 60)).toEqual(symbolFrame({ ...settings, targetFps: 30 }, cell, 30));
      expect(symbolFrame(settings, cell, 150)).toEqual(symbolFrame({ ...settings, targetFps: 12 }, cell, 30));
    }
  });

  it("amount and interval govern the event rate; infinite overrides both modes", () => {
    const settings = scatter();
    const events = (amount: number, interval: number) => Array.from({ length: 1000 }, (_, cell) =>
      symbolFrame({ ...settings, symbolMotion: { mode: "scatter", loop: false, amount, interval } }, cell, 60).frame)
      .reduce((a, b) => a + b, 0);
    expect(events(20, 250)).toBeGreaterThan(events(10, 250));
    expect(events(10, 500)).toBeLessThan(events(10, 250));
    for (const mode of ["cycle", "scatter"] as const) {
      expect(symbolFrame({ ...settings, hold: "infinite", symbolMotion: { ...settings.symbolMotion, mode } }, 123, 900))
        .toEqual({ frame: 0, hold: 1 });
    }
  });
});
