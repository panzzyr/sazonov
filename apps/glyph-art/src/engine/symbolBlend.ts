import { randomFloat } from "./hash";
import type { Settings, SymbolBlend } from "../types";

function phase(time: number, start: number, duration: number, fade: number, rank: number) {
  if (time >= start + duration - 1e-9) return 1;
  const transition = Math.min(fade, duration);
  const at = start + rank * (duration - transition);
  if (transition === 0) return time >= at ? 1 : 0;
  return Math.max(0, Math.min(1, (time - at) / transition));
}

/** Stateless cell fades: seeking, export order and scatter never affect visibility. */
export function symbolOpacity(settings: Settings, cellIndex: number, frame: number, loopFrames?: number) {
  const blend = settings.symbolBlend;
  if (!blend.enabled) return 1;
  // Use the actual still period, also when querying frames beyond the clip.
  const current = loopFrames && loopFrames > 1
    ? ((frame % loopFrames) + loopFrames) % loopFrames : Math.max(0, frame);
  const time = current / settings.targetFps;
  // Layout seed, not glyphSeed: shuffling symbols preserves the reveal choreography.
  const rank = randomFloat(settings.seed, cellIndex, 0, 81);
  const entering = phase(time, blend.enterStart, blend.enterDuration, blend.fade, rank);
  if (!blend.exitEnabled || entering === 0) return entering;
  const exitRank = blend.exitOrder === "reverse" ? 1 - rank
    : blend.exitOrder === "random" ? randomFloat(settings.seed, cellIndex, 0, 82) : rank;
  return entering * (1 - phase(time, blend.exitStart, blend.exitDuration, blend.fade, exitRank));
}

/** Reserve an empty final frame, so the reveal itself can loop without a reset. */
export function fitSymbolBlend(blend: SymbolBlend, frames: number, fps: number): SymbolBlend {
  const lastTime = Math.max(0, frames - 1) / fps;
  return { ...blend, enterStart: 0, enterDuration: lastTime / 3,
    exitStart: lastTime * 2 / 3, exitDuration: lastTime / 3 };
}
