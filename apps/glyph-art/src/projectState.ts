/**
 * Validation and portable encoding for saved projects.
 *
 * Input arrives from localStorage, a pasted URL fragment, or a downloaded
 * file, so none of it is trusted. Everything is merged onto the defaults and
 * range-checked; anything unrecognised is dropped rather than carried through.
 *
 * A saved `.json` file embeds the marks, so a project opens with the artwork
 * the user actually made. A share link does not: six embedded bitmaps in a URL
 * fragment is not a link. Uploaded marks fall back to the shipped mark of the
 * same band, and the UI says so when it copies the link.
 */

import {
  defaultBandCount,
  defaultSettings,
  markKinds,
  maxBands,
  maxExportFrames,
  maxFps,
  maxGrid,
  maxHold,
  maxWeight,
  minBands,
  minFps,
  minGrid,
  minHold,
  minWeight,
  type Band,
  type GlyphSpec,
  type Range,
  type Settings,
} from "./types";
import { defaultBandGlyphs, markDefinitions, markSpecs } from "./engine/marks";
import { initialSettings } from "./store";

/** A hostile or accidental file should not be able to exhaust memory. */
const maxGlyphs = 64;
const maxGlyphSourceBytes = 512 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function number(value: unknown, fallback: number, low: number, high: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

function readLevels(value: unknown, fallback: Range): Range {
  if (!isObject(value)) return { ...fallback };
  const min = number(value.min, fallback.min, 0, 1);
  const max = number(value.max, fallback.max, 0, 1);
  // An inverted or collapsed pair would divide the whole image into one band.
  return max - min < 0.02 ? { ...fallback } : { min, max };
}

function readGlyphs(value: unknown): GlyphSpec[] {
  const shipped = markSpecs();
  if (!Array.isArray(value)) return shipped;

  const seen = new Set<string>();
  const glyphs: GlyphSpec[] = [];
  for (const entry of value) {
    if (glyphs.length >= maxGlyphs) break;
    if (!isObject(entry)) continue;
    const { id, label, kind, source, font } = entry;
    if (typeof id !== "string" || typeof source !== "string") continue;
    if (!markKinds.includes(kind as GlyphSpec["kind"])) continue;
    if (source.length > maxGlyphSourceBytes) continue;
    if (seen.has(id)) continue;
    // Only the two schemes the app itself produces; nothing that could fetch.
    if (kind === "file" && !source.startsWith("data:image/")) continue;
    seen.add(id);
    glyphs.push({
      id,
      label: typeof label === "string" && label ? label.slice(0, 40) : id,
      kind: kind as GlyphSpec["kind"],
      source,
      ...(typeof font === "string" ? { font: font.slice(0, 16) } : {}),
    });
  }

  // The shipped set is always available, so a band can always fall back to it.
  for (const spec of shipped) {
    if (!seen.has(spec.id) && glyphs.length < maxGlyphs) glyphs.push(spec);
  }
  return glyphs;
}

function readBands(value: unknown, known: Set<string>): Band[] | null {
  if (!Array.isArray(value) || value.length < minBands) return null;
  const bands: Band[] = [];
  for (const entry of value.slice(0, maxBands)) {
    if (!isObject(entry)) {
      bands.push({ glyphs: [], size: null });
      continue;
    }
    const glyphs = Array.isArray(entry.glyphs)
      ? entry.glyphs.filter((id): id is string => typeof id === "string" && known.has(id)).slice(0, 12)
      : [];
    const size = typeof entry.size === "number" && Number.isFinite(entry.size)
      ? Math.min(2.5, Math.max(0.01, entry.size))
      : null;
    bands.push({ glyphs, size });
  }
  return bands;
}

export function parseSettings(value: unknown): Settings {
  if (!isObject(value)) throw new Error("Project is not a JSON object.");
  const incoming = isObject(value.settings) ? value.settings : value;
  const settings = initialSettings();

  settings.seed = number(incoming.seed, defaultSettings.seed, 0, 0xffff_ffff) >>> 0;
  settings.grid = Math.round(number(incoming.grid, defaultSettings.grid, minGrid, maxGrid));
  settings.weight = number(incoming.weight, defaultSettings.weight, minWeight, maxWeight);
  settings.hand = number(incoming.hand, defaultSettings.hand, 0, 1);
  settings.targetFps = Math.round(number(incoming.targetFps, defaultSettings.targetFps, minFps, maxFps));
  settings.stillFrames = Math.round(
    number(incoming.stillFrames, defaultSettings.stillFrames, 1, maxExportFrames),
  );
  settings.hold = Math.round(number(incoming.hold, defaultSettings.hold, minHold, maxHold));
  settings.levels = readLevels(incoming.levels, defaultSettings.levels);
  settings.colorMode = incoming.colorMode === "source" ? "source" : "mono";
  settings.invert = typeof incoming.invert === "boolean" ? incoming.invert : defaultSettings.invert;
  settings.rampInvert = typeof incoming.rampInvert === "boolean"
    ? incoming.rampInvert
    : defaultSettings.rampInvert;

  settings.glyphs = readGlyphs(incoming.glyphs);
  const known = new Set(settings.glyphs.map((spec) => spec.id));
  const bands = readBands(incoming.bands, known);

  // A project whose bands all came back empty would open to a blank canvas
  // with no clue why, so it falls back to the shipped ramp instead.
  const usable = bands?.some((band) => band.glyphs.length > 0) ?? false;
  settings.bands = usable && bands
    ? bands
    : defaultBandGlyphs(bands?.length ?? defaultBandCount).map((glyphs) => ({ glyphs, size: null }));

  return settings;
}

/**
 * Settings small enough for a URL fragment: uploaded and typed marks are
 * replaced by the shipped mark nearest their band, so the link still opens to
 * the same ramp shape rather than to nothing.
 */
export function shareableSettings(settings: Settings): Settings {
  const shipped = markSpecs();
  const shippedIds = new Set(shipped.map((spec) => spec.id));
  const fallbacks = defaultBandGlyphs(settings.bands.length);

  return {
    ...settings,
    glyphs: shipped,
    bands: settings.bands.map((band, index) => ({
      size: band.size,
      glyphs: band.glyphs.every((id) => shippedIds.has(id))
        ? [...band.glyphs]
        : (fallbacks[index] ?? [markDefinitions[markDefinitions.length - 1].id]),
    })),
  };
}

export function encodeSettings(settings: Settings) {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, settings: shareableSettings(settings) }),
  );
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

/** Whether a share link would lose anything. Drives the copy notice. */
export function hasCustomMarks(settings: Settings) {
  return settings.glyphs.some((spec) => spec.kind !== "mark");
}
