/**
 * The shipped mark sets.
 *
 * `generatedPresets.ts` is written by `scripts/build-glyph-presets.mjs` and
 * holds the data, compactly: the sprite sheets of each set, where every mark
 * sits on them, and which marks print on each of the twelve levels. This
 * module is the part that is written by hand — turning that into specs and
 * ids, and what applying a preset actually does to a project.
 *
 * It changes the marks and nothing else. Not the grid, not the levels, not the
 * inversion: those belong to the picture on screen, and a set of marks knows
 * nothing about it. The one thing it does bring with it is the shape of its own
 * ramp — twelve levels, the ink the darkest of them can ask for, and the size
 * ceiling those two were solved against — because that is a fact about the
 * marks rather than a preference. Airy letterpress cannot cover as much of a
 * cell as a solid woodblock without spilling out of it.
 *
 * **A band holds a preset level by reference.** The 1812 set prints every one
 * of its nearly three thousand marks, a couple of hundred per level. Written
 * out as ids, that is half a megabyte in every saved project, every undo step
 * and every share link. So a preset puts one id per band — `level:<set>:<n>`,
 * standing for every mark on that level of that set — and `bandGlyphs` expands
 * it wherever a band's marks are read. The marks themselves are never copied
 * into `settings.glyphs`; they come from this build, like their paths.
 */

import { presetData, type PresetData } from "./generatedPresets";
import type { Band, GlyphSpec, Settings } from "./types";

export { presetLevels, presetMaxSize } from "./generatedPresets";

export type Preset = {
  id: string;
  label: string;
  /** Ink coverage of the darkest level, 0..1. */
  peak: number;
  /** Size ceiling in cells that the levels were solved against. */
  maxSize: number;
  glyphs: GlyphSpec[];
  /** Mark ids per level, lightest first. The first of each is the ramp's reference. */
  levels: string[][];
};

function unpack(data: PresetData): Preset {
  const ids = data.marks.map(([slug]) => `preset-${data.id}-${slug}`);
  return {
    id: data.id,
    label: data.label,
    peak: data.peak,
    maxSize: data.maxSize,
    glyphs: data.marks.map(([slug, sheet, x, y, width, height], index) => ({
      id: ids[index],
      label: `${data.label} ${slug}`,
      kind: "preset",
      source: data.sheets[sheet],
      rect: [x, y, width, height],
    })),
    levels: data.levels.map((level) => level.map((index) => ids[index])),
  };
}

export const presets: Preset[] = presetData.map(unpack);

const presetGlyphMap = new Map(
  presets.flatMap((preset) => preset.glyphs.map((glyph) => [glyph.id, glyph] as const)),
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
 * or names a set or a level this build does not ship, which is how a reference
 * from an untrusted file is validated.
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
