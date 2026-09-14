/**
 * Per-cell variation, drawn from the seeded hash.
 *
 * Everything here is hashed on the **cell**, never on the frame. That is the
 * whole point: hash on the frame and the surface boils, every mark jittering
 * independently every frame, which reads as noise rather than as a hand. Hash
 * on the cell and the grid holds still while losing its machine regularity.
 *
 * The exception is the cycle index, which advances with the frame by design —
 * but its *phase* is still per cell, so a band's marks do not all flip at once.
 *
 * No `Math.random()` anywhere; a seed reproduces a piece exactly.
 */

import { randomFloat } from "./hash";

const ROTATION = 0;
const OFFSET_X = 1;
const OFFSET_Y = 2;
const SIZE = 3;
const PHASE = 4;

/** Widest jitter at hand = 1. Beyond this it stops reading as a printed grid. */
const maxRotation = (12 * Math.PI) / 180;
const maxOffset = 0.06;
const maxSizeJitter = 0.08;

export type CellDraw = {
  /** Radians. */
  rotation: number;
  /** Cell fractions. */
  offsetX: number;
  offsetY: number;
  /** Multiplier on the band's size. */
  sizeScale: number;
};

const still: CellDraw = { rotation: 0, offsetX: 0, offsetY: 0, sizeScale: 1 };

/**
 * One knob, three effects. They are folded together because they are never
 * useful apart: a perfect grid of identical unrotated marks reads mechanical,
 * and about 0.35 reads hand-stamped.
 */
export function handDraw(seed: number, cellIndex: number, hand: number): CellDraw {
  if (hand <= 0) return still;
  const amount = Math.min(1, hand);
  return {
    rotation: (randomFloat(seed, 0, cellIndex, ROTATION) * 2 - 1) * maxRotation * amount,
    offsetX: (randomFloat(seed, 0, cellIndex, OFFSET_X) * 2 - 1) * maxOffset * amount,
    offsetY: (randomFloat(seed, 0, cellIndex, OFFSET_Y) * 2 - 1) * maxOffset * amount,
    sizeScale: 1 + (randomFloat(seed, 0, cellIndex, SIZE) * 2 - 1) * maxSizeJitter * amount,
  };
}

/**
 * Which mark of a cycling band this cell shows on this frame.
 *
 * The per-cell phase offset is the difference between a surface that simmers
 * and a slideshow of two pictures. In lockstep the whole image flips at once,
 * and at hold = 1 it strobes; offset, the eye reads continuous activity with no
 * global event, which is what a print run or a flip-book actually looks like.
 */
export function cycleIndex(
  seed: number,
  cellIndex: number,
  poolLength: number,
  frame: number,
  hold: number,
) {
  if (poolLength <= 1) return 0;
  const phase = Math.floor(randomFloat(seed, 0, cellIndex, PHASE) * poolLength) % poolLength;
  const step = Math.floor(frame / Math.max(1, hold));
  return (step + phase) % poolLength;
}

/** Running totals of a band's weights, for `weightedCycleIndex`. */
export function cumulativeWeights(weights: readonly number[]) {
  const totals = new Float64Array(weights.length);
  let total = 0;
  weights.forEach((weight, index) => {
    total += Math.max(0, weight);
    totals[index] = total;
  });
  return totals;
}

/** Steps a cell's pick along by the golden ratio, so no two steps land close. */
const goldenStep = 0.6180339887498949;

/**
 * Which mark of a weighted band this cell shows on this frame.
 *
 * The weighted counterpart of `cycleIndex`: the cell's phase is a point on the
 * band's running total, so a mark is picked in proportion to its weight — for
 * a preset level, one over the impressions of its letterform, which makes
 * every letterform equally likely. Each step moves the point on by the golden
 * ratio, which visits the whole total evenly and never lands back where it
 * was, so a cycling cell still changes its mark every step.
 */
export function weightedCycleIndex(
  seed: number,
  cellIndex: number,
  cumulative: Float64Array,
  frame: number,
  hold: number,
) {
  const length = cumulative.length;
  if (length <= 1) return 0;
  const total = cumulative[length - 1];
  if (!(total > 0)) return 0;
  const step = Math.floor(frame / Math.max(1, hold));
  const position = ((randomFloat(seed, 0, cellIndex, PHASE) + step * goldenStep) % 1) * total;
  let low = 0;
  let high = length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cumulative[middle] > position) high = middle;
    else low = middle + 1;
  }
  return low;
}

function greatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

/**
 * Frames after which every band's cycle lines up again. With the shipped set
 * every pool holds one mark, so this is 1 — an honest answer for a tool that
 * is static until the user asks for motion.
 */
export function loopLength(poolLengths: number[], hold: number) {
  // Nothing cycles, so every frame would be identical: one frame is the loop.
  if (!poolLengths.some((length) => length > 1)) return 1;
  let multiple = 1;
  for (const length of poolLengths) {
    const value = Math.max(1, length);
    multiple = (multiple * value) / greatestCommonDivisor(multiple, value);
    if (multiple > 900) return 900;
  }
  return Math.max(1, multiple * Math.max(1, hold));
}
