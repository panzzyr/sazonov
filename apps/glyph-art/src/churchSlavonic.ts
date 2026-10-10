import {
  churchSlavonicLevels,
  churchSlavonicMarks,
  churchSlavonicMaxSize,
  churchSlavonicPeak,
  churchSlavonicSheets,
} from "./generatedChurchSlavonic";
import type { GlyphSpec } from "./types";
import type { Preset } from "./presets";

const glyphs: GlyphSpec[] = churchSlavonicMarks.map((mark, index) => ({
  id: `preset-church-slavonic-${mark.name.replace(/\.png$/, "").toLowerCase().replaceAll(" ", "-")}`,
  label: `Church Slavonic · ${mark.name}`,
  kind: "preset",
  source: churchSlavonicSheets[mark.sheet][0],
  rect: mark.rect,
  vectorPack: ["church-slavonic-vedomosti", index],
}));
const levels = churchSlavonicLevels.map((level) => level.map((index) => glyphs[index].id));

/** An isolated, hand-picked collection: no harvested marks or foreign mixes. */
export const churchSlavonicPreset: Preset = {
  id: "church-slavonic-vedomosti",
  label: "Church Slavonic Vedomosti",
  era: "Church Slavonic Vedomosti",
  variant: `Curated · ${glyphs.length} symbols`,
  peak: churchSlavonicPeak,
  maxSize: churchSlavonicMaxSize,
  glyphs,
  levels,
  weights: levels.map((level) => level.map(() => 1)),
  foreign: [],
};
