// Converts the historical mark scans in <root>/assets/glyph-presets/ into the
// web library committed under apps/glyph-art/public/presets/, and solves each
// set's twelve-level ramp into apps/glyph-art/src/generatedPresets.ts.
//
// Source originals stay out of git; only the converted marks and the generated
// module are committed, so glyph art deploys as a self-contained static site.
//
//   node scripts/build-glyph-presets.mjs
//
// Two things happen here that cannot happen in the browser.
//
// **Polarity is normalised.** The scans arrive in two shapes: three sets are
// black ink on transparency, one is *white* ink on transparency, drawn for a
// dark ground. Both are pure alpha cutouts — no set has any background at all —
// so the ink is the alpha channel in every case. Lifting alpha out and
// inverting it gives one shape for all four sets: an opaque grey image, black
// ink on white paper. The browser reads ink as `alpha × (1 − luma)`, which for
// an opaque image is exactly `1 − luma` — the same quantity this file measures,
// off the same pixels. The two agree to within a fraction of a percent; they
// are not bit-identical, because the browser re-rasterizes each mark to 256 px
// with its own resampler before measuring. The browser's number is the one the
// renderer uses, and the difference is far below the step between two levels.
//
// **Levels are solved, not authored.** Which level a mark belongs on is not a
// property of the mark; it is a property of the *size* the mark has to print
// at to hit that level's ink coverage. A sparse mark reaches a light level at a
// comfortable size and a dark level only by overflowing its cell; a solid one
// is the reverse. So every mark is measured for coverage, aspect and stroke
// width, and each level takes the marks that land inside a printable size and
// keep a stroke thick enough to survive the raster. One mark serves two or
// three levels at different sizes, which is where the variety comes from.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(root, "assets/glyph-presets");
const assetRoot = path.join(root, "apps/glyph-art/public/presets");
const modulePath = path.join(root, "apps/glyph-art/src/generatedPresets.ts");

/** Marks print at most 24 px across, so this is already generous headroom. */
const MAX_EDGE = 128;

/** Below this an anti-aliased fringe counts as ink. Matches `glyphLibrary`. */
const INK_FLOOR = 0.02;

/** Levels per preset. */
const LEVELS = 12;

/** Tone-curve exponent the presets are solved against — `defaultSettings.weight`. */
const WEIGHT = 1.45;

/**
 * Size ceiling, in cells. Marks are never clipped — the renderer stamps into a
 * full-frame mask — but past this they stop reading as separate marks and knit
 * into an unbroken mass. A little over 1 so the darkest level's seams close.
 */
const MAX_SIZE = 1.15;

/** Below this a mark is grit rather than a mark. */
const MIN_SIZE = 0.14;

/** Output pixels per cell at the default grid of 72 — `cellPixels(72)`. */
const CELL_PIXELS = 24;

/** A stroke thinner than this at print size dissolves into grey. */
const MIN_STROKE_PIXELS = 1.1;

/** How many marks a level carries. The darkest levels carry the most. */
const POOL = { normal: 2, dark: 4 };

/** Levels from this index up count as the darkest. */
const DARK_FROM = 9;

/** No mark serves more than this many levels, or the set reads as one mark. */
const MAX_REUSE = 3;

const sets = [
  { id: "eighteenth-century", label: "18th century" },
  { id: "eighteen-twelve", label: "1812" },
  { id: "great-war", label: "Great War" },
  { id: "nineteen-forty-one", label: "1941" },
];

/* ---------------------------------------------------------------- measuring */

/**
 * Lifts the ink out of a scan and returns it as black-on-white grey.
 *
 * `extractChannel("alpha")` gives a single-channel image whose value *is* the
 * ink, whichever colour the artwork was drawn in; negating turns it into paper
 * and ink. Trimming happens on the alpha, where the background is a true zero,
 * rather than on the negated image where it is white.
 */
async function normalize(sourceFile) {
  const ink = sharp(sourceFile).ensureAlpha().extractChannel("alpha");
  const trimmed = await ink
    .trim({ background: "#000000", threshold: Math.round(INK_FLOOR * 255) })
    .toBuffer()
    .catch(() => ink.toBuffer());

  return sharp(trimmed)
    .resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    })
    .negate()
    .toColorspace("b-w")
    .toBuffer();
}

/**
 * Ink density, aspect and stroke width of a normalised mark.
 *
 * Density is the mean ink over the tight box — the same quantity the ramp
 * solver asks for. Stroke width comes from a chamfer distance transform: the
 * median distance from an inked pixel to the nearest paper pixel is half the
 * typical stroke, and doubling it gives a width that can be checked against
 * the pixels the mark will actually print at.
 */
async function measure(buffer) {
  const { data, info } = await sharp(buffer)
    .toColorspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const ink = new Float32Array(width * height);
  for (let index = 0; index < ink.length; index += 1) {
    ink[index] = 1 - data[index * channels] / 255;
  }

  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ink[y * width + x] <= INK_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return null;

  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  let sum = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) sum += ink[y * width + x];
  }

  return {
    width,
    height,
    density: sum / (boxWidth * boxHeight),
    aspect: boxWidth / boxHeight,
    stroke: strokeWidth(ink, width, height, Math.max(boxWidth, boxHeight)),
  };
}

/** Median stroke width, as a fraction of the mark's long side. */
function strokeWidth(ink, width, height, longSide) {
  const far = width + height;
  const distance = new Float32Array(width * height);
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = ink[index] > 0.5 ? far : 0;
  }

  // Chamfer 3-4: two sweeps, close enough to Euclidean for a median.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      let best = distance[index];
      if (x > 0) best = Math.min(best, distance[index - 1] + 3);
      if (y > 0) best = Math.min(best, distance[index - width] + 3);
      if (x > 0 && y > 0) best = Math.min(best, distance[index - width - 1] + 4);
      if (x < width - 1 && y > 0) best = Math.min(best, distance[index - width + 1] + 4);
      distance[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      let best = distance[index];
      if (x < width - 1) best = Math.min(best, distance[index + 1] + 3);
      if (y < height - 1) best = Math.min(best, distance[index + width] + 3);
      if (x < width - 1 && y < height - 1) best = Math.min(best, distance[index + width + 1] + 4);
      if (x > 0 && y < height - 1) best = Math.min(best, distance[index + width - 1] + 4);
      distance[index] = best;
    }
  }

  const inked = [];
  for (let index = 0; index < distance.length; index += 1) {
    if (distance[index] > 0) inked.push(distance[index] / 3);
  }
  if (inked.length === 0) return 0;
  inked.sort((a, b) => a - b);
  return (2 * inked[inked.length >> 1]) / longSide;
}

/* ------------------------------------------------------------------ solving */

/** Ink a mark covers of its cell when its long side fills the cell exactly. */
function cellCoverage(mark) {
  return mark.density * Math.min(mark.aspect, 1 / mark.aspect);
}

const bandCenter = (index) => (index + 0.5) / LEVELS;

/**
 * Ink asked of the darkest level, and with it the whole curve.
 *
 * Chosen so the fourth-densest mark of the set — the last one the darkest
 * level needs — lands just inside the size ceiling. Any higher and the level
 * could not be filled without marks overflowing their cells; any lower and the
 * set prints lighter than its own material allows. Every set therefore gets
 * its own peak: airy letterpress simply does not reach the ink a solid
 * woodblock does, and pretending otherwise would flatten the top of the ramp.
 */
function solvePeak(marks) {
  const coverages = marks.map(cellCoverage).sort((a, b) => b - a);
  const anchor = coverages[Math.min(POOL.dark, coverages.length) - 1];
  const headroom = (MAX_SIZE - 0.05) ** 2;
  return (anchor * headroom) / bandCenter(LEVELS - 1) ** WEIGHT;
}

const coverageFor = (tone, peak) => peak * tone ** WEIGHT;

/** Long-side size in cells a mark needs to print a given ink coverage. */
const sizeFor = (coverage, mark) => Math.sqrt(coverage / cellCoverage(mark));

/**
 * How well a mark prints at a level, 0 when it cannot print there at all.
 *
 * Size is the hard gate, and it is the one that decides which marks a level
 * can even consider: a light level needs so little ink that a solid woodblock
 * would have to shrink to grit to supply it, while a dark level needs so much
 * that an airy letter would have to overflow its cell. That single test sorts
 * the set across the ramp on its own.
 *
 * Stroke width is the soft one. A mark of fine rules reduced to a third of a
 * cell is a grey smudge long before it is too small to see — the failure the
 * eye notices and the coverage arithmetic cannot. It ranks marks rather than
 * excluding them, because at the light end every candidate is a hairline and
 * the level still has to be filled with the best of them.
 */
function score(mark, coverage) {
  const size = sizeFor(coverage, mark);
  if (size < MIN_SIZE || size > MAX_SIZE) return 0;

  // Marks read best somewhere near two-thirds of the cell: smaller and the
  // shape is guessed at, larger and it crowds its neighbours.
  const fit = Math.exp(-(((size - 0.62) / 0.3) ** 2));
  const strokePixels = mark.stroke * size * CELL_PIXELS;
  const legible = Math.min(1, strokePixels / 2.4);
  const survives = strokePixels >= MIN_STROKE_PIXELS ? 1 : 0.35;
  return survives * (0.15 + 0.85 * fit) * (0.3 + 0.7 * legible);
}

/**
 * Fills every level with marks.
 *
 * Darkest level first, because it is the constrained one: only a handful of
 * marks in any set are solid enough to reach it inside the size ceiling, while
 * almost anything serves a light level. Filling the loose end first would take
 * those marks and leave the dark end unfillable.
 *
 * Each level's first mark is the one the ramp solver measures the level's size
 * from, so it is the best-scoring one; the rest correct against it.
 */
function assignLevels(marks, peak) {
  const uses = new Map(marks.map((mark) => [mark.id, 0]));
  const levels = Array.from({ length: LEVELS }, () => []);
  const order = [...Array(LEVELS).keys()].reverse();

  for (const level of order) {
    const coverage = coverageFor(bandCenter(level), peak);
    const want = level >= DARK_FROM ? POOL.dark : POOL.normal;

    const ranked = marks
      .map((mark) => ({ mark, value: score(mark, coverage) }))
      .filter((entry) => entry.value > 0)
      .map((entry) => ({
        ...entry,
        // Spreading the set over the ramp beats putting the single best mark
        // on every level it happens to suit.
        value: entry.value - 0.28 * uses.get(entry.mark.id),
      }))
      .sort((a, b) => b.value - a.value);

    const chosen = [];
    for (const entry of ranked) {
      if (chosen.length >= want) break;
      if (uses.get(entry.mark.id) >= MAX_REUSE) continue;
      // Two marks of the same proportion at the same size read as one mark
      // printed twice, which is the opposite of what a pool is for.
      const twin = chosen.some((picked) => Math.abs(
        Math.log(picked.aspect / entry.mark.aspect),
      ) < 0.12);
      if (twin && chosen.length > 0) continue;
      chosen.push(entry.mark);
    }

    // The reuse cap and the proportion rule are preferences, not promises. A
    // level that cannot be filled under them is filled without them rather
    // than left short of the count the set guarantees.
    for (const entry of ranked) {
      if (chosen.length >= want) break;
      if (chosen.includes(entry.mark)) continue;
      chosen.push(entry.mark);
    }

    for (const mark of chosen) uses.set(mark.id, uses.get(mark.id) + 1);
    levels[level] = chosen;
  }

  return levels;
}

/* ------------------------------------------------------------------ writing */

async function buildSet(set) {
  const sourceDirectory = path.join(sourceRoot, set.id);
  const entries = (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|tiff?)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  const outputDirectory = path.join(assetRoot, set.id);
  await mkdir(outputDirectory, { recursive: true });

  const marks = [];
  const skipped = [];

  for (const name of entries) {
    const slug = name.replace(/\.[^.]+$/, "").padStart(2, "0");
    const buffer = await normalize(path.join(sourceDirectory, name));
    const metrics = await measure(buffer);

    // A scan this faint is not a light mark, it is a blank. Sizing it to any
    // level at all would put a mark the size of the cell where a speck belongs.
    if (!metrics || metrics.density < 0.05) {
      skipped.push(name);
      continue;
    }

    const file = `${slug}.webp`;
    await sharp(buffer).webp({ lossless: true, effort: 6 }).toFile(path.join(outputDirectory, file));
    marks.push({
      id: `preset-${set.id}-${slug}`,
      label: `${set.label} ${slug}`,
      source: `presets/${set.id}/${file}`,
      buffer,
      ...metrics,
    });
  }

  const peak = solvePeak(marks);
  const levels = assignLevels(marks, peak);
  return { ...set, peak, marks, levels, skipped };
}

function serialize(built) {
  const lines = [
    "// Generated by scripts/build-glyph-presets.mjs — do not edit by hand.",
    "//",
    "// Each preset is a set of scanned marks and the twelve-level ramp solved",
    "// for them. `peak` is the ink the darkest level asks for: it is a property",
    "// of the set, because a set of airy letterpress cannot reach the coverage a",
    "// solid woodblock does without overflowing its cells.",
    "",
    'import type { GlyphSpec } from "./types";',
    "",
    "export type Preset = {",
    "  id: string;",
    "  label: string;",
    "  /** Ink coverage of the darkest level, 0..1. */",
    "  peak: number;",
    "  /** Size ceiling in cells that the levels below were solved against. */",
    "  maxSize: number;",
    "  glyphs: GlyphSpec[];",
    "  /** Mark ids per level, lightest first. The first of each is the ramp's reference. */",
    "  levels: string[][];",
    "  /**",
    "   * Ink density and proportion of each mark, measured at build time.",
    "   *",
    "   * The browser measures every mark again on load and *that* is what the",
    "   * renderer uses; these are here so the levels can be checked without a",
    "   * canvas — that no mark overflows its cell, that the ladder climbs.",
    "   *",
    "   * The two measure the same thing off the same pixels and agree to within",
    "   * a fraction of a percent, which is far below the step between levels.",
    "   * They are not identical: the browser re-rasterizes each mark to 256 px",
    "   * with its own resampler first.",
    "   */",
    "  metrics: Record<string, { density: number; aspect: number }>;",
    "};",
    "",
    `export const presetLevels = ${LEVELS};`,
    `export const presetMaxSize = ${MAX_SIZE};`,
    "",
    "export const presets: Preset[] = [",
  ];

  for (const set of built) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(set.id)},`);
    lines.push(`    label: ${JSON.stringify(set.label)},`);
    lines.push(`    peak: ${set.peak.toFixed(4)},`);
    lines.push(`    maxSize: ${MAX_SIZE},`);
    lines.push("    glyphs: [");
    for (const mark of set.marks) {
      lines.push(
        `      { id: ${JSON.stringify(mark.id)}, label: ${JSON.stringify(mark.label)},`
        + ` kind: "preset", source: ${JSON.stringify(mark.source)} },`,
      );
    }
    lines.push("    ],");
    lines.push("    levels: [");
    for (const level of set.levels) {
      lines.push(`      [${level.map((mark) => JSON.stringify(mark.id)).join(", ")}],`);
    }
    lines.push("    ],");
    lines.push("    metrics: {");
    for (const mark of set.marks) {
      lines.push(
        `      ${JSON.stringify(mark.id)}: `
        + `{ density: ${mark.density.toFixed(5)}, aspect: ${mark.aspect.toFixed(5)} },`,
      );
    }
    lines.push("    },");
    lines.push("  },");
  }

  lines.push("];");
  lines.push("");
  lines.push("/** Every shipped mark id, for validating untrusted project files. */");
  lines.push("export const presetGlyphIds = new Set(presets.flatMap(");
  lines.push("  (preset) => preset.glyphs.map((glyph) => glyph.id),");
  lines.push("));");
  lines.push("");
  return lines.join("\n");
}

/* -------------------------------------------------------------- proof sheet */

/** Cell size for the proof sheet. Larger than print, so the marks are legible. */
const SHEET_CELL = 44;
const SHEET_BLOCK = 5;

/**
 * Renders every level as a block of stamped cells.
 *
 * The pool and the size arithmetic are visible in the generated module, but
 * whether the ladder actually *steps* is not something a table can show. This
 * prints the thing itself, at `node scripts/build-glyph-presets.mjs --sheet`.
 */
async function proofSheet(set, directory) {
  const span = SHEET_CELL * SHEET_BLOCK;
  const gap = 10;
  const width = LEVELS * (span + gap) + gap;
  const height = span + gap * 2;
  const layers = [];

  for (let level = 0; level < LEVELS; level += 1) {
    const pool = set.levels[level];
    const coverage = coverageFor(bandCenter(level), set.peak);
    const originX = gap + level * (span + gap);

    for (let index = 0; index < SHEET_BLOCK * SHEET_BLOCK; index += 1) {
      const mark = pool[index % pool.length];
      const size = sizeFor(coverage, mark);
      const long = Math.max(1, Math.round(size * SHEET_CELL));
      const markWidth = mark.aspect >= 1 ? long : Math.max(1, Math.round(long * mark.aspect));
      const markHeight = mark.aspect >= 1 ? Math.max(1, Math.round(long / mark.aspect)) : long;

      // The mark is stored as paper and ink; negating turns it back into the
      // alpha the compositor needs, and black is joined behind it.
      const alpha = await sharp(mark.buffer)
        .resize(markWidth, markHeight, { fit: "fill", kernel: "lanczos3" })
        .negate()
        .toColorspace("b-w")
        .raw()
        .toBuffer();
      const stamp = await sharp({
        create: {
          width: markWidth, height: markHeight, channels: 3, background: "#000000",
        },
      })
        .joinChannel(alpha, { raw: { width: markWidth, height: markHeight, channels: 1 } })
        .png()
        .toBuffer();

      const column = index % SHEET_BLOCK;
      const row = Math.floor(index / SHEET_BLOCK);
      layers.push({
        input: stamp,
        left: Math.round(originX + (column + 0.5) * SHEET_CELL - markWidth / 2),
        top: Math.round(gap + (row + 0.5) * SHEET_CELL - markHeight / 2),
      });
    }
  }

  const file = path.join(directory, `${set.id}.png`);
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite(layers)
    .png()
    .toFile(file);
  return file;
}

async function main() {
  await rm(assetRoot, { recursive: true, force: true });
  const built = [];
  for (const set of sets) built.push(await buildSet(set));
  await writeFile(modulePath, serialize(built), "utf8");

  let bytes = 0;
  for (const set of built) {
    for (const mark of set.marks) {
      bytes += (await readFile(path.join(root, "apps/glyph-art/public", mark.source))).byteLength;
    }
    const sizes = set.levels.map(
      (level, index) => sizeFor(coverageFor(bandCenter(index), set.peak), level[0]),
    );
    const pools = set.levels.map((level) => level.length);
    console.log(
      `${set.label.padEnd(14)} ${String(set.marks.length).padStart(2)} marks`
      + `${set.skipped.length ? ` (${set.skipped.length} blank, skipped)` : ""}`
      + `  peak ${(set.peak * 100).toFixed(0)}%`
      + `\n  sizes ${sizes.map((size) => String(Math.round(size * 100)).padStart(3)).join(" ")}`
      + `\n  pool  ${pools.map((count) => String(count).padStart(3)).join(" ")}`,
    );
  }
  console.log(`\npreset library: ${(bytes / 1024).toFixed(1)} KB across ${built.length} sets`);

  const sheetIndex = process.argv.indexOf("--sheet");
  if (sheetIndex < 0) return;
  const directory = process.argv[sheetIndex + 1] ?? path.join(root, "proof");
  await mkdir(directory, { recursive: true });
  for (const set of built) console.log(await proofSheet(set, directory));
}

await main();
