import { randomFloat } from "./hash";
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
