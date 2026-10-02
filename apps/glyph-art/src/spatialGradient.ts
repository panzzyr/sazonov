import { randomFloat } from "./engine/hash";
import type { SpatialGradient } from "./types";

/** Position spans 0..1 along cell centres, including both end steps. */
export function gradientPosition(direction: SpatialGradient["direction"], x: number, y: number,
  gridW: number, gridH: number) {
  const horizontal = direction === "right" || direction === "left";
  const count = horizontal ? gridW : gridH;
  const position = count > 1 ? (horizontal ? x : y) / (count - 1) : 0.5;
  return direction === "up" || direction === "left" ? 1 - position : position;
}

/** Blend neighbours by seeded probability, never opacity. Stable across frames. */
export function gradientStep(position: number, count: number, blend: number, seed: number, cell: number) {
  if (count < 2) return 0;
  const at = Math.max(0, Math.min(1, position)) * (count - 1);
  const first = Math.min(count - 1, Math.floor(at));
  if (first === count - 1) return first;
  const fraction = at - first;
  const width = Math.max(0, Math.min(1, blend));
  const amount = width === 0 ? (fraction >= 0.5 ? 1 : 0)
    : Math.max(0, Math.min(1, (fraction - (1 - width) / 2) / width));
  const eased = amount * amount * (3 - 2 * amount);
  return first + (randomFloat(seed, cell, 73, 11) < eased ? 1 : 0);
}
