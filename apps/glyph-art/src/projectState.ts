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
 *
 * Preset marks survive a share link, because they are a path and an id rather
 * than a bitmap. That path is the reason `readGlyphs` checks preset ids against
 * the shipped set instead of accepting the string: a project file is untrusted
 * input, and a `source` it chose freely would be a path this app hands to an
 * `<img>`. Matching against `presetGlyphIds` means only paths this build
 * produced are ever loaded.
 */

import {
  defaultBandCount,
  defaultSettings,
  dotShapes,
  halftoneWidths,
  markKinds,
  maxBands,
  maxExportFrames,
  maxFps,
  maxGain,
  maxGrid,
  maxHold,
  maxLines,
  maxPeak,
  maxSizeCeiling,
  maxSpread,
  maxWeight,
  minBands,
  minFps,
  minGain,
  minGrid,
  minHold,
  minLines,
  minPeak,
  minSizeCeiling,
  minSpread,
  minWeight,
  separations,
  type Band,
  type GlyphSpec,
  type HalftoneSettings,
  type Range,
  type Settings,
} from "./types";
import { defaultBandGlyphs, markDefinitions, markSpecs } from "./engine/marks";
import { presetGlyphs, presetGlyphIds } from "./presets";
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

  // Preset paths come from the build, never from the file being read.
  const presetSources = new Map(presetGlyphs().map((spec) => [spec.id, spec.source]));

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
    // Only the schemes the app itself produces; nothing that could fetch.
    if (kind === "file" && !source.startsWith("data:image/")) continue;
    // A preset is a path this build hands to an `<img>`, so it is accepted by
    // identity rather than by inspection: only ids this build generated pass,
    // and the path is taken from the generated module, never from the file.
    if (kind === "preset" && !presetGlyphIds.has(id)) continue;
    seen.add(id);
    glyphs.push({
      id,
      label: typeof label === "string" && label ? label.slice(0, 40) : id,
      kind: kind as GlyphSpec["kind"],
      source: kind === "preset" ? presetSources.get(id)! : source,
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

/** Six-digit hex only. Anything else is a string the CSS parser would guess at. */
function readInk(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function readHalftone(value: unknown): HalftoneSettings {
  const fallback = defaultSettings.halftone;
  if (!isObject(value)) return { ...fallback, inks: [...fallback.inks] };

  const shape = dotShapes.includes(value.shape as HalftoneSettings["shape"])
    ? (value.shape as HalftoneSettings["shape"])
    : fallback.shape;
  const separation = separations.includes(value.separation as HalftoneSettings["separation"])
    ? (value.separation as HalftoneSettings["separation"])
    : fallback.separation;
  const inks = Array.isArray(value.inks) ? value.inks : [];

  return {
    lines: Math.round(number(value.lines, fallback.lines, minLines, maxLines)),
    angle: number(value.angle, fallback.angle, 0, 90),
    shape,
    separation,
    gain: number(value.gain, fallback.gain, minGain, maxGain),
    spread: number(value.spread, fallback.spread, minSpread, maxSpread),
    blackGeneration: number(value.blackGeneration, fallback.blackGeneration, 0, 1),
    inks: [readInk(inks[0], fallback.inks[0]), readInk(inks[1], fallback.inks[1])],
    // An arbitrary width would let a project file ask for a frame that cannot
    // be allocated, so only the sizes the interface offers are accepted.
    width: halftoneWidths.includes(value.width as number)
      ? (value.width as number)
      : fallback.width,
  };
}

export function parseSettings(value: unknown): Settings {
  if (!isObject(value)) throw new Error("Project is not a JSON object.");
  const incoming = isObject(value.settings) ? value.settings : value;
  const settings = initialSettings();

  settings.seed = number(incoming.seed, defaultSettings.seed, 0, 0xffff_ffff) >>> 0;
  settings.grid = Math.round(number(incoming.grid, defaultSettings.grid, minGrid, maxGrid));
  settings.weight = number(incoming.weight, defaultSettings.weight, minWeight, maxWeight);
  settings.peak = number(incoming.peak, defaultSettings.peak, minPeak, maxPeak);
  settings.maxSize = number(
    incoming.maxSize,
    defaultSettings.maxSize,
    minSizeCeiling,
    maxSizeCeiling,
  );
  settings.mode = incoming.mode === "halftone" ? "halftone" : "glyph";
  settings.halftone = readHalftone(incoming.halftone);
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
  // Presets stay: a preset mark is an id and a path, which is a handful of
  // bytes, so a link to a preset ramp opens as the ramp it was shared as.
  const shipped = [
    ...markSpecs(),
    ...settings.glyphs.filter((spec) => spec.kind === "preset"),
  ];
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
  return settings.glyphs.some((spec) => spec.kind !== "mark" && spec.kind !== "preset");
}
