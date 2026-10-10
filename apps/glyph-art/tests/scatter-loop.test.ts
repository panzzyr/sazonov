import { describe, expect, it } from "vitest";
import { cumulativeWeights, cycleIndex, weightedCycleIndex } from "../src/engine/cellParams";
import { isScatterLoop, loopClock, loopPool, loopSymbolIndex } from "../src/engine/symbolMotion";
import { initialSettings } from "../src/store";
import type { Settings } from "../src/types";

function settings(): Settings {
  return { ...initialSettings(), targetFps: 30, stillFrames: 120,
    symbolMotion: { mode: "scatter", loop: true, amount: 10, interval: 250 } };
}

describe("seamless scatter clocks", () => {
  it("is opt-in, still-only, and inactive when the grid changes", () => {
    const value = settings();
    expect(isScatterLoop(value, 120)).toBe(true);
    expect(isScatterLoop(value)).toBe(false); // video has no still period
    expect(isScatterLoop(value, 0)).toBe(false);
    expect(isScatterLoop({ ...value, symbolMotion: { ...value.symbolMotion, loop: false } }, 120)).toBe(false);
    expect(isScatterLoop({ ...value, symbolMotion: { ...value.symbolMotion, mode: "cycle" } }, 120)).toBe(false);
    expect(isScatterLoop({ ...value, animation: { ...value.animation, enabled: true } }, 120)).toBe(false);
  });

  it("preserves exact frame-zero picks, weighted and unweighted", () => {
    const value = settings();
    for (let cell = 0; cell < 1000; cell++) {
      expect(loopSymbolIndex(value, cell, 0, 120, loopPool(53, null)))
        .toBe(cycleIndex(value.glyphSeed, cell, 53, 0, 2));
      const totals = cumulativeWeights([1, 0, 2, 4]);
      expect(loopSymbolIndex(value, cell, 0, 120, loopPool(4, totals)))
        .toBe(weightedCycleIndex(value.glyphSeed, cell, totals, 0, 2));
    }
  });

  it("is exactly periodic across many loops and arbitrary seek order", () => {
    const value = settings(), pool = loopPool(47, null);
    for (let cell = 0; cell < 100; cell++) {
      for (const frame of [0, 1, 37, 59, 60, 118, 119]) {
        const index = loopSymbolIndex(value, cell, frame, 120, pool);
        for (const offset of [-120, 120, 240, 120000]) {
          expect(loopSymbolIndex(value, cell, frame + offset, 120, pool)).toBe(index);
        }
      }
    }
  });

  it("spreads the seam like any other transition, without losing the event budget", () => {
    const value = settings();
    const transitions = new Uint32Array(120);
    let scheduled = 0;
    for (let cell = 0; cell < 5000; cell++) {
      scheduled += loopClock(value, cell, 0, 120, 10).events;
      let previous = loopClock(value, cell, 119, 120, 10).slot;
      for (let frame = 0; frame < 120; frame++) {
        const slot = loopClock(value, cell, frame, 120, 10).slot;
        if (slot !== previous) transitions[frame]++;
        previous = slot;
      }
    }
    expect(scheduled).toBeGreaterThan(7500);
    expect(scheduled).toBeLessThan(8500); // 1.6 events per cell on average
    expect(transitions.reduce((sum, n) => sum + n, 0)).toBe(scheduled);
    expect(transitions[0]).toBeGreaterThan(30);
    expect(Math.max(...transitions)).toBeLessThan(110);
    expect(Math.min(...transitions)).toBeGreaterThan(30);
  });

  it("leaves most cells static at rare rates and gives active cells at least two changes", () => {
    const value = settings();
    let active = 0;
    for (let cell = 0; cell < 10000; cell++) {
      const clock = loopClock(value, cell, 0, 30, 100); // 1 sec: budget 0.4, 20% active
      expect([0, 2]).toContain(clock.events);
      if (clock.events > 0) active++;
    }
    expect(active).toBeGreaterThan(1800);
    expect(active).toBeLessThan(2200);
  });

  it("draws distinct ring marks from the full pool and never selects zero-weight scans", () => {
    const value = { ...settings(), symbolMotion: { mode: "scatter" as const, loop: true, amount: 100, interval: 100 } };
    const totals = cumulativeWeights([0, 0.001, 0, 100, 0.2, 3, 0, 17, 0.0001]);
    const pool = loopPool(totals.length, totals);
    expect(pool.eligible).toBe(6);
    const picks = new Set<number>();
    for (let cell = 0; cell < 500; cell++) {
      const bySlot = new Map<number, number>();
      for (let frame = 0; frame < 120; frame++) {
        const clock = loopClock(value, cell, frame, 120, pool.eligible);
        const index = loopSymbolIndex(value, cell, frame, 120, pool);
        expect([0, 2, 6]).not.toContain(index);
        bySlot.set(clock.slot, index); picks.add(index);
      }
      expect(bySlot.size).toBe(4);
      expect(new Set(bySlot.values()).size).toBe(4);
    }
    // Rare weights need not appear in a finite sample; they must remain eligible.
    expect(picks.size).toBeGreaterThanOrEqual(4);
    const large = loopPool(997, null), full = new Set<number>();
    for (let cell = 0; cell < 2000; cell++) {
      for (const frame of [0, 3, 6, 9]) full.add(loopSymbolIndex(value, cell, frame, 120, large));
    }
    expect(full.size).toBeGreaterThan(990);
    expect(Math.max(...full)).toBe(996);
  });

  it("handles one-frame clips, one eligible mark, infinite hold and saturated rates", () => {
    const value = settings(), pool = loopPool(3, cumulativeWeights([0, 1, 0]));
    for (const frame of [0, 1, 59, 100000]) {
      expect(loopSymbolIndex(value, 1, frame, 120, pool)).toBe(1);
      expect(loopSymbolIndex(value, 1, frame, 1, loopPool(30, null)))
        .toBe(loopSymbolIndex(value, 1, 0, 1, loopPool(30, null)));
      expect(loopSymbolIndex({ ...value, hold: "infinite" }, 1, frame, 120, loopPool(30, null)))
        .toBe(cycleIndex(value.glyphSeed, 1, 30, 0, 2));
    }
    const fast = { ...value, targetFps: 1, symbolMotion: { ...value.symbolMotion, amount: 100, interval: 16 } };
    for (let cell = 0; cell < 100; cell++) {
      const clock = loopClock(fast, cell, 0, 3, 2);
      expect(clock.events).toBe(2);
      expect(loopSymbolIndex(fast, cell, 3, 3, loopPool(2, null)))
        .toBe(loopSymbolIndex(fast, cell, 0, 3, loopPool(2, null)));
    }
  });

  it("responds to rate, length and seed changes without consuming random state", () => {
    const value = settings();
    const events = (s: Settings, frames: number) => Array.from({ length: 1000 }, (_, cell) =>
      loopClock(s, cell, 0, frames, 20).events).reduce((a, b) => a + b, 0);
    expect(events(value, 120)).toBeGreaterThan(events(value, 30));
    expect(events({ ...value, symbolMotion: { ...value.symbolMotion, amount: 20 } }, 120)).toBeGreaterThan(events(value, 120));
    expect(events({ ...value, symbolMotion: { ...value.symbolMotion, interval: 500 } }, 120)).toBeLessThan(events(value, 120));
    const clocks = (seed: number) => Array.from({ length: 100 }, (_, cell) =>
      loopClock({ ...value, glyphSeed: seed }, cell, 60, 120, 30));
    expect(clocks(1)).not.toEqual(clocks(2));
    expect(clocks(1)).toEqual(clocks(1));
  });
});
