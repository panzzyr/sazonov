import { defaultLayers, defaultSettings, type EffectLayer, type LayerId, type Settings } from "./types";
import type { Snapshot } from "./store";

const layerIds = new Set<LayerId>(["levels", "noise", "print", "paper"]);

function validLayers(value: unknown): value is EffectLayer[] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((layer) =>
      typeof layer === "object"
      && layer !== null
      && layerIds.has((layer as EffectLayer).id)
      && typeof (layer as EffectLayer).enabled === "boolean");
}

export function parseSnapshot(value: unknown): Snapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("Preset is not a JSON object.");
  }
  const candidate = value as { settings?: Partial<Settings>; layers?: unknown };
  if (!validLayers(candidate.layers)) throw new Error("Preset has an invalid layer stack.");
  const settings = { ...defaultSettings, ...candidate.settings };
  if (!Number.isFinite(settings.seed) || settings.targetFps < 1 || settings.targetFps > 30) {
    throw new Error("Preset contains unsupported settings.");
  }
  return { settings, layers: candidate.layers };
}

export function encodeSnapshot(snapshot: Snapshot) {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeSnapshot(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return parseSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
}

export function defaultSnapshot(): Snapshot {
  return {
    settings: { ...defaultSettings },
    layers: defaultLayers.map((layer) => ({ ...layer })),
  };
}
