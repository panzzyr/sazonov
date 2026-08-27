/**
 * The shipped mark sets.
 *
 * `generatedPresets.ts` is written by `scripts/build-glyph-presets.mjs` and
 * holds the data: the marks of each set and which of them print on each of the
 * twelve levels. This module is the part that is written by hand — what
 * applying a preset actually does to a project.
 *
 * It changes the marks and nothing else. Not the grid, not the levels, not the
 * inversion: those belong to the picture on screen, and a set of marks knows
 * nothing about it. The one thing it does bring with it is the shape of its own
 * ramp — twelve levels, the ink the darkest of them can ask for, and the size
 * ceiling those two were solved against — because that is a fact about the
 * marks rather than a preference. Airy letterpress cannot cover as much of a
 * cell as a solid woodblock without spilling out of it.
 */

import { presetLevels, presets, type Preset } from "./generatedPresets";
import type { Band, GlyphSpec, Settings } from "./types";

export { presetLevels, presets, presetGlyphIds, type Preset } from "./generatedPresets";

/** Every preset mark in the build, across all sets. */
export function presetGlyphs(): GlyphSpec[] {
  return presets.flatMap((preset) => preset.glyphs.map((glyph) => ({ ...glyph })));
}

export function findPreset(id: string) {
  return presets.find((preset) => preset.id === id);
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
      (band, index) => band.glyphs.length === preset.levels[index].length
        && band.glyphs.every((id, position) => id === preset.levels[index][position]),
    ));
}

/**
 * Puts a preset's marks on the ramp.
 *
 * The preset's own marks are added to whatever the project already holds
 * rather than replacing it, so switching between sets to compare them does not
 * throw away marks the user uploaded. Hand-set band sizes are cleared, because
 * a size dragged for one set of marks means nothing for another.
 */
export function applyPreset(settings: Settings, preset: Preset) {
  for (const glyph of preset.glyphs) {
    if (!settings.glyphs.some((spec) => spec.id === glyph.id)) settings.glyphs.push({ ...glyph });
  }
  settings.bands = preset.levels.map((glyphs): Band => ({ glyphs: [...glyphs], size: null }));
  settings.peak = preset.peak;
  settings.maxSize = preset.maxSize;
}
