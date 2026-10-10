import { randomFloat } from "./hash";
import { weightedCycleIndex } from "./cellParams";
import type { Settings } from "../types";

/**
 * Independent renewal clocks, evaluated directly at any requested frame.
 * Each cell gets one random event in every interval / fraction time block.
 * Across many cells this yields the requested average event rate, without
 * global ticks, accumulated state, or replaying previous frames when seeking.
 * The event position is rehashed for every block; it is not a repeating mask.
 */
export function symbolFrame(settings: Settings, cellIndex: number, frame: number) {
  if (settings.hold === "infinite") return { frame: 0, hold: 1 };
  if (settings.symbolMotion.mode === "cycle") return { frame, hold: settings.hold };
  const { amount, interval } = settings.symbolMotion;
  const period = interval / 1000 / (amount / 100);
  const time = Math.max(0, frame) / settings.targetFps / period;
  const block = Math.floor(time);
  const phase = randomFloat(settings.glyphSeed, block, cellIndex, 5);
  return { frame: block + (time - block > phase ? 1 : 0), hold: 1 };
}

export type LoopPool = { totals: Float64Array; eligible: number };

/** Prepared once per tone pool, never scanned in the per-cell hot path. */
export function loopPool(length: number, weighted: Float64Array | null): LoopPool {
  const totals = weighted ?? Float64Array.from({ length }, (_, index) => index + 1);
  let eligible = 0;
  for (let index = 0; index < totals.length; index++) {
    if (totals[index] > (totals[index - 1] ?? 0)) eligible++;
  }
  return { totals, eligible };
}

/** Supplying a period explicitly prevents a video from accidentally using a still's length. */
export function isScatterLoop(settings: Settings, frames?: number) {
  return settings.symbolMotion.mode === "scatter" && settings.symbolMotion.loop
    && !settings.animation.enabled && frames !== undefined && frames >= 1;
}

/**
 * Short rings (2–4 distinct marks) repeat an integer number of times per clip.
 * Stochastic rounding preserves the average update budget across cells. When
 * the budget is below two updates, some cells get no ring and stay static.
 * Independent phase offsets distribute switches evenly, including N-1 -> 0.
 * No duplicated end frame, closing batch, history replay or raster crossfade.
 */
export function loopClock(settings: Settings, cell: number, frame: number, frames: number, eligible: number) {
  const budget = settings.symbolMotion.amount / 100
    * (frames / settings.targetFps) / (settings.symbolMotion.interval / 1000);
  const length = Math.min(4, eligible, frames, Math.max(2, Math.floor(budget)));
  if (settings.hold === "infinite" || length < 2) return { slot: 0, length: 1, events: 0 };
  const expected = Math.min(budget / length, Math.floor(frames / length));
  const whole = Math.floor(expected);
  const rotations = whole + (randomFloat(settings.glyphSeed, 0, cell, 6) < expected - whole ? 1 : 0);
  if (rotations === 0) return { slot: 0, length: 1, events: 0 };
  const events = rotations * length;
  const phase = randomFloat(settings.glyphSeed, 0, cell, 7);
  const wrapped = ((frame % frames) + frames) % frames;
  const slot = Math.floor(wrapped * events / frames + phase) % length;
  return { slot, length, events };
}

/** Weighted draw without replacement; remove at most three tiny CDF intervals. */
function pickOther(totals: Float64Array, excluded: number[], unit: number) {
  const sorted = [...excluded].sort((a, b) => a - b);
  const weight = (index: number) => totals[index] - (totals[index - 1] ?? 0);
  const remaining = totals[totals.length - 1] - sorted.reduce((sum, index) => sum + weight(index), 0);
  let position = unit * remaining;
  for (const index of sorted) {
    if (position >= (totals[index - 1] ?? 0)) position += weight(index);
  }
  let low = 0, high = totals.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (totals[middle] > position) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function loopSymbolIndex(settings: Settings, cell: number, frame: number, frames: number, pool: LoopPool) {
  const first = weightedCycleIndex(settings.glyphSeed, cell, pool.totals, 0, 1);
  const clock = loopClock(settings, cell, frame, frames, pool.eligible);
  if (clock.slot === 0) return first;
  // The ring is seeded independently of time. It always starts with the
  // existing frame-zero mark, draws from the entire eligible pool and closes
  // onto that exact mark. Only the at-most-four needed picks are evaluated.
  const ring = [first];
  for (let slot = 1; slot <= clock.slot; slot++) {
    ring.push(pickOther(pool.totals, ring, randomFloat(settings.glyphSeed, slot, cell, 8)));
  }
  return ring[clock.slot];
}
