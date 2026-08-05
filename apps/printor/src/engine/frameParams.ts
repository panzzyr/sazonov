/**
 * Collapses the range-based settings into the concrete numbers used to render
 * one frame.
 *
 * All randomness lives here, on the CPU, driven by `hash(seed, frame, stage,
 * channel)`. The shader receives finished scalars, which is what keeps preview
 * and export byte-identical for a given seed: both call this function with the
 * same frame index and get the same answer.
 */

import { randomFloat } from "./hash";
import {
  stageOrder,
  type PlacementSettings,
  type Range,
  type Settings,
  type StageId,
} from "../types";

/** Channel numbers are per stage, so adding one stage cannot disturb another. */
const CHANCE = 0;
const PICK = 1;
const SCALE = 2;
const ROTATION = 3;
const OFFSET_MAGNITUDE = 4;
const OFFSET_ANGLE = 5;
const PARAM_A = 6;
const PARAM_B = 7;
const PARAM_C = 8;
const PARAM_D = 9;

function stageIndex(id: StageId) {
  return stageOrder.indexOf(id) + 1;
}

function pick(range: Range, seed: number, frame: number, stage: StageId, channel: number) {
  const low = Math.min(range.min, range.max);
  const high = Math.max(range.min, range.max);
  if (low === high) return low;
  return low + (high - low) * randomFloat(seed, frame, stageIndex(stage), channel);
}

/**
 * A stage runs on a frame when it is enabled and the frame falls inside its
 * `frameChance`. The draw is independent per stage and stable per frame.
 */
export function stageActive(settings: Settings, id: StageId, frame: number) {
  const stage = settings.stages[id];
  if (!stage.enabled) return false;
  if (stage.frameChance >= 1) return true;
  if (stage.frameChance <= 0) return false;
  return randomFloat(settings.seed, frame, stageIndex(id), CHANCE) < stage.frameChance;
}

/**
 * Chooses one library texture for this frame. Returns null when the stage has
 * no textures selected, which the caller treats as "skip this stage".
 */
export function pickTexture(ids: string[], seed: number, frame: number, stage: StageId) {
  if (!ids.length) return null;
  const index = Math.min(
    ids.length - 1,
    Math.floor(randomFloat(seed, frame, stageIndex(stage), PICK) * ids.length),
  );
  return ids[index];
}

export type Placement = {
  textureId: string | null;
  /** Scale as a multiplier, already converted from the percent in settings. */
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
};

function placement(
  settings: PlacementSettings,
  seed: number,
  frame: number,
  stage: StageId,
): Placement {
  const magnitude = pick(settings.offset, seed, frame, stage, OFFSET_MAGNITUDE);
  const angle = randomFloat(seed, frame, stageIndex(stage), OFFSET_ANGLE) * Math.PI * 2;
  return {
    textureId: pickTexture(settings.textures, seed, frame, stage),
    scale: pick(settings.scale, seed, frame, stage, SCALE) / 100,
    rotation: (pick(settings.rotation, seed, frame, stage, ROTATION) * Math.PI) / 180,
    offsetX: Math.cos(angle) * magnitude,
    offsetY: Math.sin(angle) * magnitude,
  };
}

export type FrameParams = {
  frame: number;
  /** Carried through so the shader's spatial noise shares the same seed. */
  seed: number;
  active: Record<StageId, boolean>;
  motion: { strength: number; angle: number; samples: number; bothDirections: boolean };
  paper: Placement & { opacity: number; blend: number };
  grain: { grain: number; gain: number; size: number };
  torn: { balance: number; smoothness: number; contrast: number; roughness: number };
  wiggle: { offsetX: number; offsetY: number; rotation: number };
  displace: Placement & { amount: number };
  halftone: { cell: number; angle: number; strength: number };
  cutout: Placement & { feather: number; invert: boolean };
  overlay: Placement & { opacity: number; blend: number };
};

const blendIndex: Record<string, number> = {
  multiply: 0,
  screen: 1,
  overlay: 2,
  softlight: 3,
};

export function resolveFrame(settings: Settings, frame: number): FrameParams {
  const seed = settings.seed;
  const active = Object.fromEntries(
    stageOrder.map((id) => [id, stageActive(settings, id, frame)]),
  ) as Record<StageId, boolean>;

  const wiggleMagnitude = pick(settings.wiggle.amount, seed, frame, "wiggle", OFFSET_MAGNITUDE);
  const wiggleAngle = randomFloat(seed, frame, stageIndex("wiggle"), OFFSET_ANGLE) * Math.PI * 2;

  return {
    frame,
    seed,
    active,
    motion: {
      strength: pick(settings.motion.strength, seed, frame, "motion", PARAM_A),
      angle: (pick(settings.motion.angle, seed, frame, "motion", PARAM_B) * Math.PI) / 180,
      samples: Math.max(1, Math.min(24, Math.round(settings.motion.samples))),
      bothDirections: settings.motion.bothDirections,
    },
    paper: {
      ...placement(settings.paper, seed, frame, "paper"),
      opacity: pick(settings.paper.opacity, seed, frame, "paper", PARAM_A),
      blend: blendIndex[settings.paper.blend] ?? 0,
    },
    grain: {
      grain: pick(settings.grain.grain, seed, frame, "grain", PARAM_A),
      gain: pick(settings.grain.gain, seed, frame, "grain", PARAM_B),
      size: Math.max(1, pick(settings.grain.size, seed, frame, "grain", PARAM_C)),
    },
    torn: {
      balance: pick(settings.torn.balance, seed, frame, "torn", PARAM_A),
      smoothness: pick(settings.torn.smoothness, seed, frame, "torn", PARAM_B),
      contrast: pick(settings.torn.contrast, seed, frame, "torn", PARAM_C),
      roughness: pick(settings.torn.roughness, seed, frame, "torn", PARAM_D),
    },
    wiggle: {
      offsetX: Math.cos(wiggleAngle) * wiggleMagnitude,
      offsetY: Math.sin(wiggleAngle) * wiggleMagnitude,
      rotation: (pick(settings.wiggle.rotation, seed, frame, "wiggle", PARAM_A) * Math.PI) / 180,
    },
    displace: {
      ...placement(settings.displace, seed, frame, "displace"),
      amount: pick(settings.displace.amount, seed, frame, "displace", PARAM_A),
    },
    halftone: {
      cell: Math.max(1.5, pick(settings.halftone.cell, seed, frame, "halftone", PARAM_A)),
      angle: (pick(settings.halftone.angle, seed, frame, "halftone", PARAM_B) * Math.PI) / 180,
      strength: pick(settings.halftone.strength, seed, frame, "halftone", PARAM_C),
    },
    cutout: {
      ...placement(settings.cutout, seed, frame, "cutout"),
      feather: pick(settings.cutout.feather, seed, frame, "cutout", PARAM_A),
      invert: settings.cutout.invert,
    },
    overlay: {
      ...placement(settings.overlay, seed, frame, "overlay"),
      opacity: pick(settings.overlay.opacity, seed, frame, "overlay", PARAM_A),
      blend: blendIndex[settings.overlay.blend] ?? 1,
    },
  };
}

/**
 * Every library texture this settings object could need across a frame range,
 * so the caller can preload before rendering or exporting.
 */
export function texturesForRange(settings: Settings, frames: number) {
  const needed = new Set<string>();
  for (let frame = 0; frame < frames; frame += 1) {
    const params = resolveFrame(settings, frame);
    for (const stage of ["paper", "displace", "cutout", "overlay"] as const) {
      if (params.active[stage] && params[stage].textureId) {
        needed.add(params[stage].textureId as string);
      }
    }
  }
  return [...needed];
}
