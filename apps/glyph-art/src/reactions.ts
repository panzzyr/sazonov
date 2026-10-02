import { reactionType } from "./generatedReactionType";
import { pressFVector } from "./generatedPressF";
import { contoursPath, mapContours, vectorContours } from "./engine/vector";
import type { GlyphSpec } from "./types";
import type { Preset } from "./presets";

/** One-ink silhouettes; press F uses the owner's supplied vector trace. */
export const reactionIcons = {
  fire: {
    width: 32, height: 36,
    path: "M17 1C19 9 28 13 28 23C28 31 23 35 16 35C8 35 3 30 3 23C3 17 7 13 9 9C9 15 12 16 13 15C17 11 18 7 17 1Z"
      + "M16 20C15 24 10 26 11 29C12 33 20 33 21 28C21 25 18 23 16 20Z",
  },
  salute: pressFVector,
  eye: {
    width: 40, height: 26,
    path: "M1 13C5 5 12 1 20 1C28 1 35 5 39 13C35 21 28 25 20 25C12 25 5 21 1 13Z"
      + "M5 13C9 19 14 22 20 22C26 22 31 19 35 13C31 7 26 4 20 4C14 4 9 7 5 13Z"
      + "M20 7C23.3 7 26 9.7 26 13C26 16.3 23.3 19 20 19C16.7 19 14 16.3 14 13C14 9.7 16.7 7 20 7Z",
  },
};

function mark(id: string, label: string, vector: NonNullable<GlyphSpec["vector"]>): GlyphSpec {
  return {
    id: `reaction-${id}`, label, kind: "mark", vector,
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${vector.width}" height="${vector.height}" viewBox="0 0 ${vector.width} ${vector.height}"><path fill="#000" d="${vector.path}"/></svg>`,
  };
}

/** Every label has exactly two digits: 10k..99k and 0,1k..9,9k. */
export const reactionCounts = [
  ...Array.from({ length: 90 }, (_, index) => `${index + 10}k`),
  ...Array.from({ length: 90 }, (_, index) => `${Math.floor(index / 9)},${index % 9 + 1}k`),
];

/** Roboto Medium, at one fixed size; the whole counter is a single mark. */
function counter(label: string): NonNullable<GlyphSpec["vector"]> {
  let x = 0;
  let path = "";
  for (const char of label) {
    const letter = reactionType[char];
    path += contoursPath(mapContours(vectorContours(letter.path), ([px, py]) => [px + x, py + 74]));
    x += letter.advance;
  }
  return { width: Math.ceil(x + 2), height: 96, path };
}

const icons = [
  mark("fire", "fire", reactionIcons.fire),
  mark("salute", "press F / salute", reactionIcons.salute),
  mark("eye", "views", reactionIcons.eye),
];
const counts = reactionCounts.map((label, index) => mark(`count-${index}`, label, counter(label)));
const iconIds = icons.map((glyph) => glyph.id);
const countIds = counts.map((glyph) => glyph.id);

// Tiny silhouettes lose their identity. The lightest quarter prints counters
// only; all 180 values remain available at every tone, including the shadows.
const levels = Array.from({ length: 12 }, (_, index) => index < 3
  ? [...countIds] : [...iconIds, ...countIds]);

/** Whole-pool shares, not per-mark weights: counters stay the majority. */
export const reactionShares = Array.from({ length: 12 }, (_, index) => {
  const counters = index < 3 ? 1 : index < 6 ? 0.9 : index < 9 ? 0.7 : 0.65;
  const eye = index < 3 ? 0 : index < 6 ? 0.02 : 0.05;
  return { counters, eye, reactions: 1 - counters - eye };
});

export const reactionsPreset: Preset = {
  id: "digital-reactions",
  label: "Today · Digital reactions",
  era: "Today · Digital reactions",
  variant: "Monochrome",
  peak: 0.55,
  maxSize: 1.45,
  glyphs: [...icons, ...counts],
  levels,
  weights: levels.map((level, band) => level.map((id) => id.startsWith("reaction-count-")
    ? reactionShares[band].counters / counts.length
    : id === "reaction-eye" ? reactionShares[band].eye : reactionShares[band].reactions / 2)),
  foreign: [],
};
