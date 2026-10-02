import { reactionType } from "./generatedReactionType";
import { contoursPath, mapContours, vectorContours } from "./engine/vector";
import type { GlyphSpec } from "./types";
import type { Preset } from "./presets";

/** Original simplified silhouettes, one ink, with no emoji/font dependency. */
export const reactionIcons = {
  fire: {
    width: 32, height: 36,
    path: "M17 1C19 9 28 13 28 23C28 31 23 35 16 35C8 35 3 30 3 23C3 17 7 13 9 9C9 15 12 16 13 15C17 11 18 7 17 1Z"
      + "M16 20C15 24 10 26 11 29C12 33 20 33 21 28C21 25 18 23 16 20Z",
  },
  salute: {
    width: 40, height: 34,
    path: "M17 2C9 2 3 8 3 17C3 26 9 32 18 32C26 32 32 26 33 18L29 18C28 24 24 28 18 28C11 28 7 24 7 17C7 10 11 6 17 6C21 6 24 7 27 10L30 7C27 4 22 2 17 2Z"
      + "M21 12C19 14 20 18 24 17L33 16L28 22L33 24L38 15C39 12 37 10 34 11L28 13L35 8C37 6 35 4 33 5L21 12Z"
      + "M13 13C15 13 15 17 13 17C11 17 11 13 13 13Z"
      + "M12 22L14 20C17 23 20 23 23 20L25 22C21 26 16 26 12 22Z",
  },
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
function counter(label: string, withEye: boolean): NonNullable<GlyphSpec["vector"]> {
  let x = withEye ? 90 : 0;
  let path = withEye
    ? contoursPath(mapContours(vectorContours(reactionIcons.eye.path), ([px, py]) => [px * 2, py * 2 + 17]))
    : "";
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
const counts = reactionCounts.map((label, index) => mark(`count-${index}`, label, counter(label, false)));
const views = reactionCounts.map((label, index) => mark(`views-${index}`, `views ${label}`, counter(label, true)));
const iconIds = icons.map((glyph) => glyph.id);

// Wide counters belong to the light levels. Dark levels use the silhouettes,
// which can carry enough ink without stretching a counter beyond its cell.
const levels = Array.from({ length: 12 }, (_, index) => index < 6
  ? [...iconIds, ...counts.slice(index * 30, (index + 1) * 30).map((glyph) => glyph.id),
    ...views.slice(index * 30, (index + 1) * 30).map((glyph) => glyph.id)]
  : [...iconIds]);

export const reactionsPreset: Preset = {
  id: "digital-reactions",
  label: "Today · Digital reactions",
  era: "Today · Digital reactions",
  variant: "Monochrome",
  peak: 0.55,
  maxSize: 1.45,
  glyphs: [...icons, ...counts, ...views],
  levels,
  // Each icon and each family of counters gets an equal share, so a hundred
  // counters do not crowd the two reactions and the eye off the picture.
  weights: levels.map((level) => level.map((_, index) => index < 3 ? 1 : 1 / 30)),
  foreign: [],
};
