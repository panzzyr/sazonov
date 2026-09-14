/**
 * The shipped mark sets.
 *
 * `generatedPresets.ts` is written by `scripts/build-glyph-presets.mjs` and
 * holds the data, compactly: groups of marks packed on sprite sheets, and the
 * eras built from them. This module is the part that is written by hand —
 * turning that back into specs, ids and levels, and what applying a preset
 * actually does to a project.
 *
 * **An era is two presets.** Each period's Russian marks make one; where the
 * war left foreign print too — French in 1812, English in the Crimea, Ottoman,
 * Japanese and German — the second is the same Russian ramp with foreign marks
 * mixed into every level at no more than 30% of it. Both share the Russian
 * sheets, so switching between them loads only the foreign ones.
 *
 * It changes the marks and nothing else. Not the grid, not the levels, not the
 * inversion: those belong to the picture on screen, and a set of marks knows
 * nothing about it. The one thing it does bring with it is the shape of its own
 * ramp — twelve levels, the ink the darkest of them can ask for, and the size
 * ceiling those two were solved against — because that is a fact about the
 * marks rather than a preference.
 *
 * **A band holds a preset level by reference.** A level is hundreds of marks.
 * Written out as ids, that is megabytes in every saved project, every undo
 * step and every share link. So a preset puts one id per band —
 * `level:<preset>:<n>`, standing for every mark on that level — and
 * `bandGlyphs` expands it wherever a band's marks are read. The marks
 * themselves are never copied into `settings.glyphs`; they come from this
 * build, like their paths.
 */

import {
  presetEras,
  presetGroups,
  presetLevelAlphabet,
  presetLevels,
  presetSizeAlphabet,
  type PresetGroupData,
} from "./generatedPresets";
import { packShelves } from "./sheetPacking";
import type { Band, GlyphSpec, Settings } from "./types";

export { presetLevels, presetMaxSize } from "./generatedPresets";

export type Preset = {
  id: string;
  label: string;
  /** The era's own name, shared by its Russian and its foreign preset. */
  era: string;
  /** Which of the era's presets this is: `Russian`, or the foreign mix. */
  variant: string;
  /** Ink coverage of the darkest level, 0..1. */
  peak: number;
  /** Size ceiling in cells that the levels were solved against. */
  maxSize: number;
  glyphs: GlyphSpec[];
  /** Mark ids per level, lightest first. The first of each is the ramp's reference. */
  levels: string[][];
  /**
   * How likely each mark of a level is to be picked, parallel to `levels`: one
   * over the impressions sharing its letterform, so every letterform of a
   * level is equally likely however common its letter is.
   */
  weights: number[][];
  /** The foreign marks among `glyphs`; empty for a Russian preset. */
  foreign: string[];
};

/** A group's marks, placed on its sheets by replaying the build's packing. */
function unpackGroup(data: PresetGroupData): GlyphSpec[] {
  const sizes: [number, number][] = [];
  for (let index = 0; index < data.sizes.length; index += 2) {
    sizes.push([
      presetSizeAlphabet.indexOf(data.sizes[index]) + 1,
      presetSizeAlphabet.indexOf(data.sizes[index + 1]) + 1,
    ]);
  }
  return packShelves(sizes).places.map((place, index) => ({
    id: `preset-${data.id}-${index}`,
    label: `${data.id} ${index}`,
    kind: "preset",
    source: data.sheets[place.sheet][0],
    rect: [place.x, place.y, sizes[index][0], sizes[index][1]],
  }));
}

const groupGlyphs = new Map(presetGroups.map((data) => [data.id, unpackGroup(data)]));
const glyphsOf = (groups: string[]) => groups.flatMap((id) => groupGlyphs.get(id) ?? []);

/**
 * An era's levels, as ids: one character per mark naming its level, or — for
 * an era small enough to reuse marks — indices per level. The reference moves
 * to the front of its level.
 */
/** A mark's weight: one over the impressions sharing its letterform on its level. */
function weightOf(weights: string, index: number) {
  const size = presetSizeAlphabet.indexOf(weights[index] ?? "") + 1;
  return size > 0 ? 1 / size : 1;
}

type Decoded = { ids: string[][]; weights: number[][] };

/**
 * An era's levels, as ids and weights: one character per mark naming its
 * level, or — for an era small enough to reuse marks — indices per level. The
 * reference moves to the front of its level.
 */
function decodeLevels(
  levels: string | number[][],
  references: number[],
  ids: string[],
  extra = "",
  weights = "",
  extraWeights = "",
): Decoded {
  if (typeof levels !== "string") {
    return {
      ids: levels.map((level) => level.map((index) => ids[index])),
      weights: levels.map((level) => level.map(() => 1)),
    };
  }
  const decoded = Array.from({ length: presetLevels }, () => ({ ids: [] as string[], weights: [] as number[] }));
  for (let index = 0; index < levels.length; index += 1) {
    const level = presetLevelAlphabet.indexOf(levels[index]);
    if (level < 0) continue;
    decoded[level].ids.push(ids[index]);
    decoded[level].weights.push(weightOf(weights, index));
  }
  // A mark reused on a dark level, at a larger size, to keep that level as
  // deep as the rest.
  for (let index = 0; index < extra.length; index += 1) {
    const level = presetLevelAlphabet.indexOf(extra[index]);
    if (level < 0) continue;
    decoded[level].ids.push(ids[index]);
    decoded[level].weights.push(weightOf(extraWeights, index));
  }
  decoded.forEach((level, index) => {
    const reference = references[index] ?? -1;
    const position = reference < 0 ? -1 : level.ids.indexOf(ids[reference]);
    if (position <= 0) return;
    level.ids.unshift(...level.ids.splice(position, 1));
    level.weights.unshift(...level.weights.splice(position, 1));
  });
  return { ids: decoded.map((level) => level.ids), weights: decoded.map((level) => level.weights) };
}

/** The most of any level's weight that its foreign marks may carry. Matches the build. */
const foreignShare = 0.3;

export const presets: Preset[] = presetEras.flatMap((era) => {
  const nativeGlyphs = glyphsOf(era.native.groups);
  const native = decodeLevels(
    era.native.levels,
    era.native.references,
    nativeGlyphs.map((glyph) => glyph.id),
    era.native.extra,
    era.native.weights,
    era.native.extraWeights,
  );
  const shared = { era: era.label, peak: era.peak, maxSize: era.maxSize };
  const russian: Preset = {
    ...shared,
    id: era.id,
    label: era.label,
    variant: "Russian",
    glyphs: nativeGlyphs,
    levels: native.ids,
    weights: native.weights,
    foreign: [],
  };
  if (!era.foreign) return [russian];

  const foreignGlyphs = glyphsOf(era.foreign.groups);
  const foreign = decodeLevels(
    era.foreign.levels,
    [],
    foreignGlyphs.map((glyph) => glyph.id),
    "",
    era.foreign.weights,
  );
  return [russian, {
    ...shared,
    id: era.foreign.id,
    label: `${era.label} ${era.foreign.label}`,
    variant: era.foreign.label,
    glyphs: [...nativeGlyphs, ...foreignGlyphs],
    // Russian first, so every level's reference stays the Russian one.
    levels: native.ids.map((level, index) => [...level, ...foreign.ids[index]]),
    // Foreign letterforms are rarer than Russian ones — most Ottoman words and
    // kanji occur once — so weighed by letterform they would outweigh the
    // Russian marks they are an accent in. They are scaled down to the same
    // 30% of a level's weight that they are held to in number.
    weights: native.weights.map((own, index) => {
      const theirs = foreign.weights[index];
      const ownTotal = own.reduce((sum, weight) => sum + weight, 0);
      const theirTotal = theirs.reduce((sum, weight) => sum + weight, 0);
      const room = (ownTotal * foreignShare) / (1 - foreignShare);
      const scale = theirTotal > room ? room / theirTotal : 1;
      return [...own, ...theirs.map((weight) => weight * scale)];
    }),
    foreign: foreign.ids.flat(),
  }];
});

/** The presets grouped by era, in the order the tool lists them. */
export const presetEraList = presetEras.map((era) => ({
  label: era.label,
  presets: presets.filter((preset) => preset.era === era.label),
}));

const presetGlyphMap = new Map(
  [...groupGlyphs.values()].flatMap((glyphs) => glyphs.map((glyph) => [glyph.id, glyph] as const)),
);

/** Every shipped mark id, for validating untrusted project files. */
export const presetGlyphIds: ReadonlySet<string> = new Set(presetGlyphMap.keys());

/** The build's own spec for a preset mark — its path and its box on the sheet. */
export function presetGlyph(id: string): GlyphSpec | undefined {
  const glyph = presetGlyphMap.get(id);
  return glyph && { ...glyph };
}

export function findPreset(id: string) {
  return presets.find((preset) => preset.id === id);
}

/* ---------------------------------------------------------- level references */

const levelPattern = /^level:([a-z0-9-]+):(\d{1,2})$/;

/** The band entry that stands for every mark on one level of a preset. */
export function levelToken(presetId: string, level: number) {
  return `level:${presetId}:${level}`;
}

function readToken(id: string) {
  const match = levelPattern.exec(id);
  if (!match) return undefined;
  const preset = findPreset(match[1]);
  const level = Number(match[2]);
  return preset && level < preset.levels.length ? { preset, level } : undefined;
}

/**
 * The marks a level reference stands for, or undefined when `id` is not one —
 * or names a preset or a level this build does not ship, which is how a
 * reference from an untrusted file is validated.
 */
export function levelMarks(id: string): readonly string[] | undefined {
  const token = readToken(id);
  return token && token.preset.levels[token.level];
}

/** How a level reference is named in the interface. */
export function levelLabel(id: string) {
  const token = readToken(id);
  return token && `${token.preset.label} · level ${token.level}`;
}

/**
 * Every mark a band prints, in cycle order, with level references expanded.
 *
 * This is what the renderer, the ramp solver and the ramp editor read instead
 * of `band.glyphs`. The result may be the build's own array; never mutate it.
 */
export function bandGlyphs(band: Band): readonly string[] {
  if (band.glyphs.length === 1) return levelMarks(band.glyphs[0]) ?? band.glyphs;
  return band.glyphs.flatMap((id) => levelMarks(id) ?? [id]);
}

/**
 * How likely each mark of `bandGlyphs(band)` is to be picked, in the same
 * order — or undefined for a band of the project's own marks, which are all
 * equally likely. A mark of the project's own in a band beside a preset level
 * weighs 1, as much as a whole letterform of the level.
 */
export function bandWeights(band: Band): readonly number[] | undefined {
  const tokens = band.glyphs.map(readToken);
  if (!tokens.some(Boolean)) return undefined;
  if (band.glyphs.length === 1) return tokens[0]!.preset.weights[tokens[0]!.level];
  return tokens.flatMap((token) => (token ? token.preset.weights[token.level] : [1]));
}

/**
 * Every mark the project needs loaded: its own, plus the preset marks its
 * bands name by reference.
 */
export function librarySpecs(settings: Pick<Settings, "glyphs" | "bands">): GlyphSpec[] {
  const specs = [...settings.glyphs];
  const seen = new Set(specs.map((spec) => spec.id));
  for (const band of settings.bands) {
    for (const id of band.glyphs) {
      for (const mark of levelMarks(id) ?? []) {
        if (seen.has(mark)) continue;
        seen.add(mark);
        specs.push(presetGlyphMap.get(mark)!);
      }
    }
  }
  return specs;
}

/**
 * Which preset a project is currently on, if any.
 *
 * Judged by what the bands print rather than by a stored name, so it stays
 * true after an undo, a shared link, or a mark dragged onto one level by hand:
 * the moment the ramp stops being the preset's, the interface stops claiming
 * it is.
 */
export function activePreset(settings: Settings): Preset | undefined {
  return presets.find((preset) => settings.bands.length === preset.levels.length
    && settings.bands.every(
      (band, index) => band.glyphs.length === 1 && band.glyphs[0] === levelToken(preset.id, index),
    ));
}

/**
 * Puts a preset's marks on the ramp, one level reference per band.
 *
 * Whatever the project already holds stays in `settings.glyphs`, so switching
 * between sets to compare them does not throw away marks the user uploaded.
 * Hand-set band sizes are cleared, because a size dragged for one set of marks
 * means nothing for another.
 */
export function applyPreset(settings: Settings, preset: Preset) {
  settings.bands = preset.levels.map((_, index): Band => ({
    glyphs: [levelToken(preset.id, index)],
    size: null,
  }));
  settings.peak = preset.peak;
  settings.maxSize = preset.maxSize;
}
