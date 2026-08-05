/**
 * Validation and portable encoding for saved projects.
 *
 * Input arrives from localStorage, a pasted URL fragment, or a downloaded
 * file, so none of it is trusted. Everything is merged onto the defaults and
 * range-checked; anything unrecognised is dropped rather than carried through.
 */

import {
  defaultSettings,
  maxExportFrames,
  maxFps,
  minFps,
  stageOrder,
  textureStages,
  type Range,
  type Settings,
  type StageId,
} from "./types";
import { textureById } from "./generatedTextures";
import { withDefaultTextures } from "./store";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown, fallback: number, low: number, high: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

function readRange(value: unknown, fallback: Range, low: number, high: number): Range {
  if (!isObject(value)) return { ...fallback };
  return {
    min: number(value.min, fallback.min, low, high),
    max: number(value.max, fallback.max, low, high),
  };
}

/** Per-parameter clamps, so a hand-edited project cannot ask for absurd values. */
const limits: Record<string, [number, number]> = {
  "motion.strength": [0, 200],
  "motion.angle": [-360, 360],
  "paper.scale": [100, 1000],
  "paper.rotation": [-360, 360],
  "paper.offset": [0, 1],
  "paper.opacity": [0, 1],
  "grain.grain": [0, 1],
  "grain.gain": [0, 8],
  "grain.size": [1, 32],
  "torn.balance": [0, 1],
  "torn.smoothness": [0, 1],
  "torn.contrast": [0, 1],
  "torn.roughness": [0, 2],
  "wiggle.amount": [0, 200],
  "wiggle.rotation": [-45, 45],
  "displace.scale": [100, 1000],
  "displace.rotation": [-360, 360],
  "displace.offset": [0, 1],
  "displace.amount": [0, 200],
  "halftone.cell": [1.5, 64],
  "halftone.angle": [-360, 360],
  "halftone.strength": [0, 1],
  "cutout.scale": [100, 1000],
  "cutout.rotation": [-360, 360],
  "cutout.offset": [0, 1],
  "cutout.feather": [0, 0.5],
  "overlay.scale": [100, 1000],
  "overlay.rotation": [-360, 360],
  "overlay.offset": [0, 1],
  "overlay.opacity": [0, 1],
};

function mergeStage(stage: StageId, incoming: unknown, target: Settings) {
  if (!isObject(incoming)) return;
  const defaults = defaultSettings[stage] as Record<string, unknown>;
  const result = target[stage] as Record<string, unknown>;

  for (const [key, fallback] of Object.entries(defaults)) {
    const value = incoming[key];
    if (value === undefined) continue;

    if (isObject(fallback) && "min" in fallback && "max" in fallback) {
      const [low, high] = limits[`${stage}.${key}`] ?? [-1000, 1000];
      result[key] = readRange(value, fallback as Range, low, high);
      continue;
    }
    if (typeof fallback === "boolean" && typeof value === "boolean") {
      result[key] = value;
      continue;
    }
    if (typeof fallback === "number" && typeof value === "number") {
      result[key] = number(value, fallback, 0, 64);
      continue;
    }
    if (typeof fallback === "string" && typeof value === "string") {
      // Blend modes and other enums: only accept a value the defaults use.
      if (key === "blend" && !["multiply", "screen", "overlay", "softlight"].includes(value)) continue;
      result[key] = value;
      continue;
    }
    if (Array.isArray(fallback) && Array.isArray(value)) {
      // Texture selections are filtered against the shipped library, so a
      // project referencing textures this build does not have still loads.
      result[key] = value.filter((id): id is string => typeof id === "string" && textureById.has(id));
    }
  }
}

export function parseSettings(value: unknown): Settings {
  if (!isObject(value)) throw new Error("Project is not a JSON object.");
  const incoming = isObject(value.settings) ? value.settings : value;
  const settings = structuredClone(defaultSettings);

  settings.seed = number(incoming.seed, defaultSettings.seed, 0, 0xffff_ffff) >>> 0;
  settings.targetFps = Math.round(number(incoming.targetFps, defaultSettings.targetFps, minFps, maxFps));
  settings.stillFrames = Math.round(
    number(incoming.stillFrames, defaultSettings.stillFrames, 1, maxExportFrames),
  );
  settings.invert = typeof incoming.invert === "boolean" ? incoming.invert : defaultSettings.invert;

  if (isObject(incoming.stages)) {
    for (const id of stageOrder) {
      const stage = incoming.stages[id];
      if (!isObject(stage)) continue;
      if (typeof stage.enabled === "boolean") settings.stages[id].enabled = stage.enabled;
      settings.stages[id].frameChance = number(stage.frameChance, settings.stages[id].frameChance, 0, 1);
    }
  }

  for (const id of stageOrder) mergeStage(id, incoming[id], settings);

  // A project that selected no textures for a stage would render it inert;
  // fall back to the library defaults so the file always opens to something.
  const hasSelection = textureStages.some((stage) => settings[stage].textures.length > 0);
  return hasSelection ? settings : withDefaultTextures(settings);
}

export function encodeSettings(settings: Settings) {
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 3, settings }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeSettings(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return parseSettings(JSON.parse(new TextDecoder().decode(bytes)));
}
