import type { BackgroundCleanup } from "../types";

/** Clip source backgrounds, not the remapped tone: inversion cannot swap the filters. */
export function clippedTone(tone: number, cleanup: BackgroundCleanup) {
  return (cleanup.black && tone <= cleanup.blackTolerance + 1e-7)
    || (cleanup.white && tone >= 1 - cleanup.whiteTolerance - 1e-7);
}
