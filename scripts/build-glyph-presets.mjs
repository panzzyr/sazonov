// Converts the historical mark scans in <root>/assets/glyph-presets/ into the
// web library committed under apps/glyph-art/public/presets/, and solves the
// twelve-level ramp of every preset into apps/glyph-art/src/generatedPresets.ts.
//
//   node scripts/build-glyph-presets.mjs [--sheet <dir>]
//
// Source originals stay out of git; only the converted marks and the generated
// modules are committed, so glyph art deploys as a self-contained static site.
//
// **Groups, eras, presets.** A group is one directory of marks — scans picked
// by hand, plus `harvested/`, which `harvest-glyphs.mjs` cuts out of whole
// pages — and it is packed onto its own sprite sheets. An era is a period of
// Russian military history: its Russian groups, and the foreign groups printed
// in the same war, if there are any. Each era ships up to two presets over the
// same sheets: the Russian marks alone, and the Russian marks with the foreign
// ones mixed in at no more than `FOREIGN_SHARE` of any level.
//
// **Every Russian mark prints.** The pool of a level is how varied it looks,
// so an era's Russian marks are not chosen among — every one that can print
// anywhere is dealt onto exactly one level. Only an era too small to fill
// twelve levels that way (1941, for now) chooses, reusing marks across levels.
//
// Two things happen here that cannot happen in the browser.
//
// **Polarity is normalised.** Scans arrive as black ink or white ink on
// transparency; the ink is the alpha channel either way. Lifting alpha out and
// inverting it gives one shape for all of them: opaque grey, black on white.
//
// **Levels are solved, not authored.** Which level a mark belongs on is not a
// property of the mark; it is a property of the *size* the mark has to print
// at to hit that level's ink coverage. Every mark is measured for coverage,
// aspect and stroke width, and each level takes the marks that land inside a
// printable size and keep a stroke thick enough to survive the raster.

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(root, "assets/glyph-presets");
const assetRoot = path.join(root, "apps/glyph-art/public/presets");
const modulePath = path.join(root, "apps/glyph-art/src/generatedPresets.ts");
const metricsPath = path.join(root, "apps/glyph-art/src/generatedPresetMetrics.ts");

/**
 * Long edge of a mark on its sheet. Marks print at about 30 px on the default
 * frame, so this keeps more than twice that. It must stay within the size
 * alphabet below, which writes each side of a mark as one character.
 */
const MAX_EDGE = 80;

/** Lossy WebP quality for a group's sheets; hand-picked groups stay lossless. */
const QUALITY = 75;

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

/**
 * Size ceiling of the darkest level, in cells; the three darkest levels climb
 * to it from `MAX_SIZE`. Only the solid marks reach a dark level's ink inside
 * one cell, so under the plain ceiling the darkest level had a fifth of the
 * marks of the others — and those are the largest marks on the picture, the
 * ones the eye lands on, repeating. Past the cell a mark overlaps its
 * neighbours, which on the darkest level is what it should do: the shadows
 * knit into mass. It is also the preset's `maxSize`, so nothing is clamped.
 */
const DARK_CEILING = 1.45;

/** Below this a mark is grit rather than a mark. */
const MIN_SIZE = 0.14;

/** Canonical proof-sheet pixels per cell used to reject strokes that dissolve. */
const CELL_PIXELS = 24;

/** A stroke thinner than this at print size dissolves into grey. */
const MIN_STROKE_PIXELS = 1.1;

/**
 * An era with fewer Russian marks than this cannot fill twelve levels with a
 * mark each and still vary them, so it chooses instead, with reuse.
 */
const SMALL_ERA = LEVELS * 8;

/** Pool sizes for a small era: every level, and the darkest three. */
const POOL = { normal: 2, dark: 4 };

/** Levels from this index up count as the darkest. */
const DARK_FROM = 9;

/** In a small era no mark serves more than this many levels. */
const MAX_REUSE = 3;

/**
 * How many of an era's densest marks the darkest level is anchored on.
 *
 * `solvePeak` sets the ink of the darkest level so that this many marks still
 * fit inside the cell. Higher gives the darkest level more marks to cycle
 * through and a lighter top to the ramp; the two are the same trade.
 */
const EVERY_ANCHOR = 24;

/**
 * The most of any level that foreign marks may be. The Russian marks are the
 * body of every era; the foreign ones are an accent in it.
 */
const FOREIGN_SHARE = 0.3;

/** Groups, in the order their marks are listed. `lossless` for hand-picked scans. */
const groups = [
  { id: "eighteenth-century", lossless: true },
  { id: "vedomosti" },
  { id: "eighteen-twelve" },
  { id: "french" },
  { id: "crimean" },
  { id: "english" },
  { id: "russo-turkish" },
  { id: "ottoman" },
  { id: "russo-japanese" },
  { id: "great-war", lossless: true },
  { id: "japanese" },
  { id: "german" },
  { id: "civil-war" },
  { id: "local-conflicts" },
  { id: "spanish" },
  { id: "finnish-mongolian", limit: 3000 },
  { id: "japanese-1939" },
  { id: "great-patriotic" },
  { id: "nineteen-forty-one", lossless: true },
  { id: "german-1941" },
  // Six pages of Pravda and fourteen of 1967 alone cut into 93,000 marks —
  // twenty-odd megabytes of sheets for one preset.
  { id: "cold-war", limit: 12000 },
  { id: "korean" },
  { id: "vietnamese" },
  { id: "arabic", limit: 3000 },
  { id: "hebrew", limit: 3000 },
  { id: "dari" },
];

/**
 * A group's `limit` caps its harvested marks, taken at an even stride through
 * them. Harvested files are named by page, so the stride takes the same share
 * of every page rather than the first pages whole. Hand-picked scans are
 * always kept. For a Russian group the limit is what a visitor downloads; for
 * a foreign one it is only what the builder chooses among, since a foreign
 * preset takes at most 30% of a level anyway.
 */

/** The eras, in the order the tool lists them. */
const eras = [
  {
    id: "northern-and-patriotic",
    label: "1700–1812 · Northern & Patriotic wars",
    native: ["eighteenth-century", "vedomosti", "eighteen-twelve"],
    foreign: { id: "northern-and-patriotic-french", label: "+ French", groups: ["french"] },
  },
  {
    id: "crimean",
    label: "1853–1856 · Crimean War",
    native: ["crimean"],
    foreign: { id: "crimean-english", label: "+ English", groups: ["english"] },
  },
  {
    id: "russo-turkish",
    label: "1877–1878 · Russo-Turkish War",
    native: ["russo-turkish"],
    foreign: { id: "russo-turkish-ottoman", label: "+ Ottoman", groups: ["ottoman"] },
  },
  {
    id: "russo-japanese-and-great",
    label: "1904–1918 · Russo-Japanese & First World wars",
    native: ["russo-japanese", "great-war"],
    foreign: {
      id: "russo-japanese-and-great-foreign",
      label: "+ Japanese & German",
      groups: ["japanese", "german"],
    },
  },
  { id: "civil", label: "1917–1922 · Civil War", native: ["civil-war"] },
  {
    id: "local-conflicts",
    label: "1936–1940 · Spain, Khalkhin Gol, Finland",
    native: ["local-conflicts"],
    foreign: {
      id: "local-conflicts-foreign",
      label: "+ Spanish, Finnish, Mongolian & Japanese",
      groups: ["spanish", "finnish-mongolian", "japanese-1939"],
    },
  },
  {
    id: "great-patriotic",
    label: "1941–1945 · Great Patriotic War",
    native: ["great-patriotic", "nineteen-forty-one"],
    foreign: { id: "great-patriotic-german", label: "+ German", groups: ["german-1941"] },
  },
  {
    id: "cold-war",
    label: "1950–1989 · Korea, Vietnam, Middle East, Afghanistan",
    native: ["cold-war"],
    foreign: {
      id: "cold-war-foreign",
      label: "+ Korean, Vietnamese, Arabic, Hebrew & Dari",
      groups: ["korean", "vietnamese", "arabic", "hebrew", "dari"],
    },
  },
];

/**
 * Each side of a mark is written as one character of this alphabet: printable
 * ASCII from `#` to `~`, less the backslash, so the string needs no escaping.
 * Index 0 is one pixel.
 */
const SIZE_ALPHABET = Array.from({ length: 92 }, (_, index) => String.fromCharCode(35 + index))
  .filter((character) => character !== "\\")
  .join("");

/** A mark's level as one character; `-` for a mark that prints nowhere. */
const LEVEL_ALPHABET = "0123456789ab";

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
    signature: signature(ink, width, { left, top, boxWidth, boxHeight }),
  };
}

/** Edge of the shape thumbnail used to tell two marks apart. */
const SIGNATURE = 12;

/**
 * A coarse thumbnail of the mark, stretched from its tight box to a square.
 *
 * Proportion is normalised out on purpose: it is measured separately and it is
 * already part of the size solve, so leaving it in would make a level count a
 * narrow and a wide impression of the same letter as two different marks.
 */
function signature(ink, width, box) {
  const thumb = new Float32Array(SIGNATURE * SIGNATURE);
  for (let cellY = 0; cellY < SIGNATURE; cellY += 1) {
    const top = box.top + Math.floor((cellY * box.boxHeight) / SIGNATURE);
    const bottom = Math.max(top + 1, box.top + Math.floor(((cellY + 1) * box.boxHeight) / SIGNATURE));
    for (let cellX = 0; cellX < SIGNATURE; cellX += 1) {
      const left = box.left + Math.floor((cellX * box.boxWidth) / SIGNATURE);
      const right = Math.max(left + 1, box.left + Math.floor(((cellX + 1) * box.boxWidth) / SIGNATURE));
      let total = 0;
      let samples = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          total += ink[y * width + x];
          samples += 1;
        }
      }
      thumb[cellY * SIGNATURE + cellX] = total / (samples || 1);
    }
  }
  return thumb;
}

/** RMS difference between two thumbnails: 0 is the same mark twice. */
function unlike(a, b) {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    total += delta * delta;
  }
  return Math.sqrt(total / a.length);
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
 * Chosen so the `pool.dark`-th densest mark — the last one the darkest level
 * needs — lands just inside the size ceiling. Any higher and the level could
 * not be filled without marks overflowing their cells; any lower and the era
 * prints lighter than its own material allows.
 */
function solvePeak(marks, pool) {
  const coverages = marks.map(cellCoverage).sort((a, b) => b - a);
  const anchor = coverages[Math.min(pool.dark, coverages.length) - 1];
  const headroom = (MAX_SIZE - 0.05) ** 2;
  return (anchor * headroom) / bandCenter(LEVELS - 1) ** WEIGHT;
}

const coverageFor = (tone, peak) => peak * tone ** WEIGHT;

/** The size ceiling of a level: `MAX_SIZE`, climbing to `DARK_CEILING` over the darkest three. */
const ceilingFor = (level) => MAX_SIZE
  + (DARK_CEILING - MAX_SIZE) * Math.max(0, (level - (DARK_FROM - 1)) / (LEVELS - DARK_FROM));

/** Long-side size in cells a mark needs to print a given ink coverage. */
const sizeFor = (coverage, mark) => Math.sqrt(coverage / cellCoverage(mark));

/**
 * How well a mark prints at a level, 0 when it cannot print there at all.
 *
 * Size is the hard gate: a light level needs so little ink that a solid
 * woodblock would have to shrink to grit to supply it, while a dark level
 * needs so much that an airy letter would have to overflow its cell. Stroke
 * width is the soft one: a mark of fine rules reduced to a third of a cell is
 * a grey smudge long before it is too small to see.
 */
function score(mark, coverage, ceiling = MAX_SIZE) {
  if (!(mark.density > 0)) return 0;
  const size = sizeFor(coverage, mark);
  if (size < MIN_SIZE || size > ceiling) return 0;

  // Marks read best somewhere near two-thirds of the cell: smaller and the
  // shape is guessed at, larger and it crowds its neighbours.
  const fit = Math.exp(-(((size - 0.62) / 0.3) ** 2));
  const strokePixels = mark.stroke * size * CELL_PIXELS;
  const legible = Math.min(1, strokePixels / 2.4);
  const survives = strokePixels >= MIN_STROKE_PIXELS ? 1 : 0.35;
  return survives * (0.15 + 0.85 * fit) * (0.3 + 0.7 * legible);
}

/**
 * Picks `want` of `eligible` to be as unlike each other as possible.
 *
 * Every mark in a pool prints, cycling from cell to cell, so a pool filled from
 * the top of a ranked list ends up as ten impressions of the same letter —
 * technically ten marks, visibly one. So after the first, which is the one
 * that prints best, each pick is the candidate furthest in shape from
 * everything already picked, with print quality as a weight. `chosen` seeds the
 * distances — the marks already on the level — and is not returned.
 */
function pickUnlike(eligible, want, coverage, chosen = [], uses = null, ceiling = MAX_SIZE) {
  if (eligible.length <= want) return [...eligible];
  const value = eligible.map((mark) => score(mark, coverage, ceiling) - (uses ? 0.28 * uses.get(mark) : 0));
  const best = Math.max(...value);
  const nearest = eligible.map((mark) => Math.min(Infinity, ...chosen.map((other) => unlike(mark.signature, other.signature))));
  const taken = new Array(eligible.length).fill(false);
  const picked = [];

  const take = (index) => {
    taken[index] = true;
    picked.push(eligible[index]);
    for (let other = 0; other < eligible.length; other += 1) {
      if (taken[other]) continue;
      const distance = unlike(eligible[other].signature, eligible[index].signature);
      if (distance < nearest[other]) nearest[other] = distance;
    }
  };

  if (chosen.length === 0) take(value.indexOf(best));
  while (picked.length < want) {
    let pick = -1;
    let pickScore = -Infinity;
    for (let index = 0; index < eligible.length; index += 1) {
      if (taken[index]) continue;
      const quality = best > 0 ? Math.max(0, value[index]) / best : 1;
      const unused = uses && uses.get(eligible[index]) === 0 ? 1.2 : 1;
      const candidate = nearest[index] * (0.55 + 0.45 * quality) * unused;
      if (candidate > pickScore) {
        pickScore = candidate;
        pick = index;
      }
    }
    if (pick < 0) break;
    take(pick);
  }
  return picked;
}

/**
 * Deals every mark of an era onto exactly one level.
 *
 * Nothing is chosen and nothing is left out: each mark that can print
 * anywhere prints somewhere, and a level's pool is every mark dealt to it.
 * Darkest level first, densest marks first: only the solid marks can reach
 * the dark end inside the size ceiling, and they have to be claimed before the
 * light levels, where anything fits, take them. Each level takes an even share
 * of what is left, so the pools stay comparable; a dark level that fewer marks
 * reach takes all of them and leaves a larger share to the rest. Dealing
 * densest-first also keeps a level's marks near one size.
 *
 * The first mark of a level is the one that prints it best, because the ramp
 * solver measures the level's size from it.
 */
function dealEvery(marks, peak) {
  const levels = Array.from({ length: LEVELS }, () => []);
  const left = new Set(marks);

  for (let level = LEVELS - 1; level >= 0; level -= 1) {
    const coverage = coverageFor(bandCenter(level), peak);
    // Dealt under the plain ceiling. Dealt under the raised dark ceilings, the
    // three darkest levels take their even shares first and densest-first —
    // exactly the solid marks the level below them needs — and on the Civil
    // War that left level 8 with none at all. The dark levels are deepened
    // afterwards, by `topUpDark`, from marks that are already placed.
    const eligible = [...left]
      .filter((mark) => score(mark, coverage) > 0)
      .sort((a, b) => cellCoverage(b) - cellCoverage(a));
    const share = Math.ceil(left.size / (level + 1));
    for (const mark of eligible.slice(0, share)) {
      levels[level].push(mark);
      left.delete(mark);
    }
  }

  // A mark the even shares passed over still goes wherever it prints best. One
  // that prints nowhere is the only thing left out.
  for (const mark of left) {
    let best = -1;
    let bestValue = 0;
    for (let level = 0; level < LEVELS; level += 1) {
      const value = score(mark, coverageFor(bandCenter(level), peak));
      if (value > bestValue) {
        bestValue = value;
        best = level;
      }
    }
    if (best >= 0) levels[best].push(mark);
  }

  const extra = topUpDark(levels, marks, peak);
  return {
    levels: levels.map((level, index) => withReferenceFirst(level, coverageFor(bandCenter(index), peak), ceilingFor(index))),
    extra,
  };
}

/**
 * An even sample of `want` from `list`, which is sorted: every part of it
 * contributes its share.
 *
 * This, not `pickUnlike`, is how marks are sampled out of a whole page. The
 * marks furthest in shape from everything else on a page are its oddities — an
 * ink blot, a block of small type fused by `--join`, a torn letter — so
 * choosing for difference out of thousands fills a level with exactly those.
 * An even sample keeps the proportions of the page: a little of its rubbish,
 * a great deal of its type.
 */
function spread(list, want) {
  if (list.length <= want) return [...list];
  return Array.from({ length: want }, (_, index) => list[Math.floor((index * list.length) / want)]);
}

/**
 * Deepens the darkest levels to the depth of the rest, by reuse.
 *
 * Even with the ceiling raised, fewer marks reach the darkest ink than any
 * other, and a dark level is where a mark prints largest and repeats most
 * visibly. So each of the darkest three is topped up to the median depth of
 * the lighter levels with marks already dealt elsewhere that also print there
 * — at a larger size, so a second impression of a mark is not the same
 * impression — sampled evenly across what qualifies. A mark is reused on one
 * extra level at most. Returns mark → its extra level.
 */
function topUpDark(levels, marks, peak) {
  const extra = new Map();
  const depths = levels.slice(0, DARK_FROM).map((level) => level.length).sort((a, b) => a - b);
  const target = depths[depths.length >> 1] ?? 0;

  for (let level = LEVELS - 1; level >= DARK_FROM; level -= 1) {
    const want = target - levels[level].length;
    if (want <= 0) continue;
    const coverage = coverageFor(bandCenter(level), peak);
    const ceiling = ceilingFor(level);
    const onLevel = new Set(levels[level]);
    const eligible = marks
      .filter((mark) => !onLevel.has(mark) && !extra.has(mark) && score(mark, coverage, ceiling) > 0)
      .sort((a, b) => cellCoverage(b) - cellCoverage(a));
    for (const mark of spread(eligible, want)) {
      levels[level].push(mark);
      extra.set(mark, level);
    }
  }
  return extra;
}

function withReferenceFirst(level, coverage, ceiling = MAX_SIZE) {
  if (level.length === 0) return level;
  // The reference must print inside the plain ceiling: the ramp sizes the
  // level from it, and every other mark is corrected against it.
  let reference = null;
  for (const mark of level) {
    const value = score(mark, coverage, Math.min(ceiling, MAX_SIZE)) || score(mark, coverage, ceiling) * 0.01;
    if (!reference || value > reference.value) reference = { mark, value };
  }
  return [reference.mark, ...level.filter((mark) => mark !== reference.mark)];
}

/**
 * Fills a small era's levels by choosing, with reuse.
 *
 * An era of a couple of dozen scans cannot give every level a mark of its own,
 * so a mark serves up to `MAX_REUSE` levels at different sizes. Darkest level
 * first, because only a handful of marks are solid enough to reach it.
 */
function assignLevels(marks, peak) {
  const uses = new Map(marks.map((mark) => [mark, 0]));
  const levels = Array.from({ length: LEVELS }, () => []);

  for (let level = LEVELS - 1; level >= 0; level -= 1) {
    const coverage = coverageFor(bandCenter(level), peak);
    const want = level >= DARK_FROM ? POOL.dark : POOL.normal;
    const printable = marks.filter((mark) => score(mark, coverage) > 0);
    const eligible = printable.filter((mark) => uses.get(mark) < MAX_REUSE);
    const chosen = pickUnlike(eligible, want, coverage, [], uses);

    // The reuse cap is a preference, not a promise. A level that cannot be
    // filled under it is filled without it.
    const ranked = [...printable].sort((a, b) => score(b, coverage) - score(a, coverage));
    for (const mark of ranked) {
      if (chosen.length >= want) break;
      if (!chosen.includes(mark)) chosen.push(mark);
    }

    for (const mark of chosen) uses.set(mark, uses.get(mark) + 1);
    levels[level] = withReferenceFirst(chosen, coverage);
  }
  return levels;
}

/**
 * Mixes an era's foreign marks into its Russian levels.
 *
 * Each level takes at most as many foreign marks as keeps them under
 * `FOREIGN_SHARE` of it, so the Russian marks stay the body of every level and
 * the ramp's reference — the first mark — stays Russian. Where the foreign
 * material is more than that allows, the marks taken are an even sample of
 * what prints there (see `spread`), which also mixes the scripts of an era
 * with several in proportion to what each of them has.
 */
function dealForeign(marks, peak, nativeLevels) {
  const levels = Array.from({ length: LEVELS }, () => []);
  const used = new Set();
  for (let level = LEVELS - 1; level >= 0; level -= 1) {
    const cap = Math.floor((nativeLevels[level].length * FOREIGN_SHARE) / (1 - FOREIGN_SHARE));
    const coverage = coverageFor(bandCenter(level), peak);
    const ceiling = ceilingFor(level);
    const eligible = marks
      .filter((mark) => !used.has(mark) && score(mark, coverage, ceiling) > 0)
      .sort((a, b) => cellCoverage(b) - cellCoverage(a));
    const picked = spread(eligible, cap);
    for (const mark of picked) used.add(mark);
    levels[level] = picked;
  }
  return levels;
}

/* ------------------------------------------------------------------ writing */

/** A sheet is at most this many pixels on a side. Matches `src/sheetPacking.ts`. */
const SHEET_EDGE = 2048;

/** Paper between marks on a sheet. Matches `src/sheetPacking.ts`. */
const GUTTER = 2;

/**
 * Shelf packing, in the order given.
 *
 * The browser replays exactly this to find each mark on its sheet from the
 * sizes alone — `packShelves` in `src/sheetPacking.ts` is the same loop, and
 * `tests/presets.test.ts` checks that the two arrive at the same sheets.
 */
function packShelves(sizes) {
  const places = [];
  const sheets = [];
  let sheet = { width: 0, height: 0 };
  let x = GUTTER;
  let y = GUTTER;
  let shelf = 0;
  for (const [width, height] of sizes) {
    if (x + width + GUTTER > SHEET_EDGE) {
      x = GUTTER;
      y += shelf + GUTTER;
      shelf = 0;
    }
    if (y + height + GUTTER > SHEET_EDGE) {
      sheets.push(sheet);
      sheet = { width: 0, height: 0 };
      x = GUTTER;
      y = GUTTER;
      shelf = 0;
    }
    places.push({ sheet: sheets.length, x, y });
    sheet.width = Math.max(sheet.width, x + width + GUTTER);
    sheet.height = Math.max(sheet.height, y + height + GUTTER);
    x += width + GUTTER;
    shelf = Math.max(shelf, height);
  }
  if (sizes.length > 0) sheets.push(sheet);
  return { places, sheets };
}

/** Image files directly inside a directory, in a stable order. */
async function imagesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|tiff?)$/i.test(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** Reads a group's scans — hand-picked and harvested alike — and measures them. */
async function loadGroup(group) {
  const directory = path.join(sourceRoot, group.id);
  let harvested = await imagesIn(path.join(directory, "harvested"));
  if (group.limit && harvested.length > group.limit) {
    const all = harvested;
    harvested = Array.from({ length: group.limit }, (_, index) => all[Math.floor((index * all.length) / group.limit)]);
  }
  const files = [...(await imagesIn(directory)), ...harvested];
  const marks = [];
  const skipped = [];
  const seen = new Set();

  for (const file of files) {
    const slug = path.basename(file).replace(/\.[^.]+$/, "").padStart(2, "0");
    if (seen.has(slug)) throw new Error(`${group.id}: two marks are both called "${slug}".`);
    seen.add(slug);
    const buffer = await normalize(file);
    const metrics = await measure(buffer);
    // A scan this faint is not a light mark, it is a blank.
    if (!metrics || metrics.density < 0.05) {
      skipped.push(file);
      continue;
    }
    marks.push({ group: group.id, slug, buffer, ...metrics });
  }
  if (marks.length === 0) throw new Error(`${group.id}: no marks in ${directory}.`);
  return { ...group, marks, skipped, candidates: files.length };
}

/**
 * Packs a group's marks onto sheets, writes them, and gives every mark its id.
 *
 * Tallest first, so a shelf wastes little; ties broken by name, so the layout
 * depends only on the marks and a rebuild of the same group writes the same
 * sheets. A mark's id is its position in that order. Not additive: the
 * group's output directory is wiped first.
 */
async function writeGroup(group, marks) {
  const outputDirectory = path.join(assetRoot, group.id);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const order = [...marks].sort((a, b) => b.height - a.height || a.slug.localeCompare(b.slug, "en", { numeric: true }));
  const { places, sheets } = packShelves(order.map((mark) => [mark.width, mark.height]));
  order.forEach((mark, index) => Object.assign(mark, places[index], { id: `preset-${group.id}-${index}` }));

  const written = [];
  for (const [index, sheet] of sheets.entries()) {
    const source = `presets/${group.id}/sheet-${index}.webp`;
    await sharp({ create: { width: sheet.width, height: sheet.height, channels: 3, background: "#ffffff" } })
      .composite(order.filter((mark) => mark.sheet === index).map((mark) => ({ input: mark.buffer, left: mark.x, top: mark.y })))
      .toColorspace("b-w")
      .webp(group.lossless ? { lossless: true, effort: 6 } : { quality: QUALITY, effort: 6 })
      .toFile(path.join(root, "apps/glyph-art/public", source));
    written.push({ source, ...sheet });
  }

  await measureSheets(written, order);
  return { ...group, marks: order, sheets: written };
}

/**
 * Re-measures each mark's density and proportion off the sheets as written,
 * by the rule the browser uses. For a lossless sheet that is the same number;
 * for a lossy one it is what the browser will measure, and the ramp is solved
 * on it — otherwise a soft scan whose faint fringe the encoder lifts past the
 * ink floor measures a different box in the browser than here.
 */
async function measureSheets(sheets, marks) {
  const decoded = await Promise.all(sheets.map((sheet) =>
    sharp(path.join(root, "apps/glyph-art/public", sheet.source))
      .toColorspace("b-w")
      .raw()
      .toBuffer({ resolveWithObject: true })));

  for (const mark of marks) {
    const { data, info } = decoded[mark.sheet];
    const ink = (x, y) => 1 - data[(y * info.width + x) * info.channels] / 255;
    let left = Infinity;
    let right = -1;
    let top = Infinity;
    let bottom = -1;
    for (let y = mark.y; y < mark.y + mark.height; y += 1) {
      for (let x = mark.x; x < mark.x + mark.width; x += 1) {
        if (ink(x, y) <= INK_FLOOR) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (right < left) {
      mark.density = 0;
      continue;
    }
    const boxWidth = right - left + 1;
    const boxHeight = bottom - top + 1;
    let sum = 0;
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) sum += ink(x, y);
    }
    mark.density = sum / (boxWidth * boxHeight);
    mark.aspect = boxWidth / boxHeight;
  }
}

/** Builds one era: its Russian ramp, and its foreign marks mixed into it. */
async function buildEra(era, loaded) {
  const nativeGroups = [];
  for (const id of era.native) nativeGroups.push(await writeGroup(loaded.get(id), loaded.get(id).marks));
  const native = nativeGroups.flatMap((group) => group.marks);

  const small = native.length < SMALL_ERA;
  const peak = solvePeak(native, small ? POOL : { dark: EVERY_ANCHOR });
  const dealt = small ? { levels: assignLevels(native, peak), extra: new Map() } : dealEvery(native, peak);
  const nativeLevels = dealt.levels;
  const nativeExtra = dealt.extra;

  let foreign = null;
  if (era.foreign) {
    // Chosen once on the measurements before compression, so only the marks
    // that will print are written; then dealt again on what shipped.
    const candidates = era.foreign.groups.flatMap((id) => loaded.get(id).marks);
    const chosen = new Set(dealForeign(candidates, peak, nativeLevels).flat());
    const foreignGroups = [];
    for (const id of era.foreign.groups) {
      const group = loaded.get(id);
      foreignGroups.push(await writeGroup(group, group.marks.filter((mark) => chosen.has(mark))));
    }
    const marks = foreignGroups.flatMap((group) => group.marks);
    foreign = { ...era.foreign, groups: foreignGroups, marks, levels: dealForeign(marks, peak, nativeLevels) };
  }

  return { ...era, small, peak, nativeGroups, native, nativeLevels, nativeExtra, foreign };
}

/* ------------------------------------------------------------- serialising */

/**
 * One character per mark: the level it prints on, or `-` for none. A mark
 * reused on a dark level is in `extra`, and its first level is the one here.
 */
function levelString(marks, levels, extra = new Map()) {
  const level = new Map();
  levels.forEach((pool, index) => pool.forEach((mark) => {
    if (extra.get(mark) !== index) level.set(mark, index);
  }));
  return marks.map((mark) => (level.has(mark) ? LEVEL_ALPHABET[level.get(mark)] : "-")).join("");
}

/** One character per mark: the dark level it is reused on, or `-`. */
function extraString(marks, extra) {
  return marks.map((mark) => (extra.has(mark) ? LEVEL_ALPHABET[extra.get(mark)] : "-")).join("");
}

/**
 * The module the app imports. Compact on purpose: it is in the bundle, and the
 * eras hold tens of thousands of marks between them. A mark is two characters
 * — its width and height — and the browser replays the shelf packing to find
 * it on its sheet; a level assignment is one character per mark. `src/presets.ts`
 * turns it back into specs, ids and levels.
 */
function serialize(groupsBuilt, erasBuilt) {
  const lines = [
    "// Generated by scripts/build-glyph-presets.mjs — do not edit by hand.",
    "//",
    "// Mark groups, packed on sprite sheets, and the eras built from them. A",
    "// group's `sizes` holds every mark's width and height, one character each",
    "// from `presetSizeAlphabet`, in packing order; `src/sheetPacking.ts` replays",
    "// the packing to place them. An era's `levels` holds one character per mark",
    "// of its groups, in order: its level from `presetLevelAlphabet`, or `-`.",
    "// `src/presets.ts` turns all of it into specs, ids and levels.",
    "",
    "export type PresetGroupData = {",
    "  id: string;",
    "  /** Each sheet: its path under the base URL, then its width and height. */",
    "  sheets: [string, number, number][];",
    "  sizes: string;",
    "};",
    "",
    "export type PresetEraData = {",
    "  id: string;",
    "  label: string;",
    "  /** Ink coverage of the darkest level, 0..1. */",
    "  peak: number;",
    "  /** Size ceiling in cells that the levels were solved against. */",
    "  maxSize: number;",
    "  native: {",
    "    groups: string[];",
    "    /** One character per mark, or — for an era small enough to reuse marks — indices per level. */",
    "    levels: string | number[][];",
    "    /** Per level, the index of the mark the ramp measures the level from. */",
    "    references: number[];",
    "    /** One character per mark: a dark level it prints on as well, at a larger size, or `-`. */",
    "    extra: string;",
    "  };",
    "  foreign?: { id: string; label: string; groups: string[]; levels: string };",
    "};",
    "",
    `export const presetLevels = ${LEVELS};`,
    `export const presetMaxSize = ${DARK_CEILING};`,
    `export const presetSizeAlphabet = ${JSON.stringify(SIZE_ALPHABET)};`,
    `export const presetLevelAlphabet = ${JSON.stringify(LEVEL_ALPHABET)};`,
    "",
    "export const presetGroups: PresetGroupData[] = [",
  ];

  for (const group of groupsBuilt) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(group.id)},`);
    lines.push(`    sheets: [${group.sheets.map((sheet) => `[${JSON.stringify(sheet.source)}, ${sheet.width}, ${sheet.height}]`).join(", ")}],`);
    lines.push(`    sizes: ${JSON.stringify(group.marks.map((mark) => SIZE_ALPHABET[mark.width - 1] + SIZE_ALPHABET[mark.height - 1]).join(""))},`);
    lines.push("  },");
  }
  lines.push("];", "", "export const presetEras: PresetEraData[] = [");

  for (const era of erasBuilt) {
    const index = new Map(era.native.map((mark, position) => [mark, position]));
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(era.id)},`);
    lines.push(`    label: ${JSON.stringify(era.label)},`);
    lines.push(`    peak: ${era.peak.toFixed(4)},`);
    lines.push(`    maxSize: ${DARK_CEILING},`);
    lines.push("    native: {");
    lines.push(`      groups: ${JSON.stringify(era.native.length ? era.nativeGroups.map((group) => group.id) : [])},`);
    lines.push(era.small
      ? `      levels: ${JSON.stringify(era.nativeLevels.map((level) => level.map((mark) => index.get(mark))))},`
      : `      levels: ${JSON.stringify(levelString(era.native, era.nativeLevels, era.nativeExtra))},`);
    lines.push(`      references: ${JSON.stringify(era.nativeLevels.map((level) => (level.length ? index.get(level[0]) : -1)))},`);
    lines.push(`      extra: ${JSON.stringify(era.small ? "" : extraString(era.native, era.nativeExtra))},`);
    lines.push("    },");
    if (era.foreign) {
      lines.push(
        `    foreign: { id: ${JSON.stringify(era.foreign.id)}, label: ${JSON.stringify(era.foreign.label)},`
        + ` groups: ${JSON.stringify(era.foreign.groups.map((group) => group.id))},`
        + ` levels: ${JSON.stringify(levelString(era.foreign.marks, era.foreign.levels))} },`,
      );
    }
    lines.push("  },");
  }
  lines.push("];", "");
  return lines.join("\n");
}

/**
 * Ink density and proportion of every shipped mark, in a module of its own.
 * Only the tests import it, so it stays out of the bundle.
 */
function serializeMetrics(groupsBuilt) {
  const lines = [
    "// Generated by scripts/build-glyph-presets.mjs — do not edit by hand.",
    "//",
    "// Ink density and proportion of every shipped mark, measured off the sheets",
    "// as written, keyed by mark id. Imported by the tests only, so it never",
    "// reaches the bundle: the browser measures each mark again on load, off the",
    "// same pixels by the same rule, and gets the same numbers.",
    "",
    "export const presetMetrics: Record<string, { density: number; aspect: number }> = {",
  ];
  for (const group of groupsBuilt) {
    for (const mark of group.marks) {
      lines.push(`  ${JSON.stringify(mark.id)}: { density: ${mark.density.toFixed(5)}, aspect: ${mark.aspect.toFixed(5)} },`);
    }
  }
  lines.push("};", "");
  return lines.join("\n");
}

/* -------------------------------------------------------------- proof sheet */

/** Cell size for the proof sheet. Larger than print, so the marks are legible. */
const SHEET_CELL = 44;
const SHEET_BLOCK = 5;

/**
 * Renders every level as a block of stamped cells.
 *
 * Whether the ladder actually *steps* is not something a table can show. This
 * prints the thing itself, at `node scripts/build-glyph-presets.mjs --sheet`.
 */
async function proofSheet(name, levels, peak, directory) {
  const span = SHEET_CELL * SHEET_BLOCK;
  const gap = 10;
  const width = LEVELS * (span + gap) + gap;
  const height = span + gap * 2;
  const layers = [];
  const cells = SHEET_BLOCK * SHEET_BLOCK;

  for (let level = 0; level < LEVELS; level += 1) {
    const pool = levels[level];
    if (pool.length === 0) continue;
    const coverage = coverageFor(bandCenter(level), peak);
    const originX = gap + level * (span + gap);

    for (let index = 0; index < cells; index += 1) {
      // A pool deeper than the block is sampled across its whole length, so
      // the sheet shows the range of a level rather than its first few marks.
      const mark = pool.length > cells ? pool[Math.floor((index * pool.length) / cells)] : pool[index % pool.length];
      const size = sizeFor(coverage, mark);
      const long = Math.max(1, Math.round(size * SHEET_CELL));
      const markWidth = mark.aspect >= 1 ? long : Math.max(1, Math.round(long * mark.aspect));
      const markHeight = mark.aspect >= 1 ? Math.max(1, Math.round(long / mark.aspect)) : long;

      const alpha = await sharp(mark.buffer)
        .resize(markWidth, markHeight, { fit: "fill", kernel: "lanczos3" })
        .negate()
        .toColorspace("b-w")
        .raw()
        .toBuffer();
      const stamp = await sharp({ create: { width: markWidth, height: markHeight, channels: 3, background: "#000000" } })
        .joinChannel(alpha, { raw: { width: markWidth, height: markHeight, channels: 1 } })
        .png()
        .toBuffer();

      layers.push({
        input: stamp,
        left: Math.round(originX + ((index % SHEET_BLOCK) + 0.5) * SHEET_CELL - markWidth / 2),
        top: Math.round(gap + (Math.floor(index / SHEET_BLOCK) + 0.5) * SHEET_CELL - markHeight / 2),
      });
    }
  }

  const file = path.join(directory, `${name}.png`);
  await sharp({ create: { width, height, channels: 3, background: "#ffffff" } }).composite(layers).png().toFile(file);
  return file;
}

/* --------------------------------------------------------------------- main */

async function main() {
  const loaded = new Map();
  for (const group of groups) loaded.set(group.id, await loadGroup(group));

  const erasBuilt = [];
  for (const era of eras) erasBuilt.push(await buildEra(era, loaded));

  const groupsBuilt = [];
  for (const era of erasBuilt) groupsBuilt.push(...era.nativeGroups, ...(era.foreign?.groups ?? []));
  const order = new Map(groups.map((group, index) => [group.id, index]));
  groupsBuilt.sort((a, b) => order.get(a.id) - order.get(b.id));

  await writeFile(modulePath, serialize(groupsBuilt, erasBuilt), "utf8");
  await writeFile(metricsPath, serializeMetrics(groupsBuilt), "utf8");

  const bytes = new Map();
  for (const group of groupsBuilt) {
    let total = 0;
    for (const sheet of group.sheets) total += (await readFile(path.join(root, "apps/glyph-art/public", sheet.source))).byteLength;
    bytes.set(group.id, total);
  }
  const megabytes = (ids) => (ids.reduce((sum, id) => sum + bytes.get(id), 0) / 1024 / 1024).toFixed(2);

  for (const era of erasBuilt) {
    const nativeIds = era.nativeGroups.map((group) => group.id);
    const printed = new Set(era.nativeLevels.flat()).size;
    console.log(
      `${era.label}\n  Russian  ${String(printed).padStart(5)} of ${String(era.native.length).padStart(5)} marks`
      + `  peak ${(era.peak * 100).toFixed(0)}%  ${megabytes(nativeIds)} MB${era.small ? "  (chosen, with reuse)" : ""}`
      + `\n  pool     ${era.nativeLevels.map((level) => String(level.length).padStart(4)).join(" ")}`,
    );
    if (era.foreign) {
      const foreignIds = era.foreign.groups.map((group) => group.id);
      const pools = era.foreign.levels.map((level, index) => level.length / (level.length + era.nativeLevels[index].length || 1));
      const placed = era.foreign.levels.flat();
      const candidates = era.foreign.groups.reduce((sum, group) => sum + loaded.get(group.id).marks.length, 0);
      const byGroup = foreignIds.map((id) => `${id} ${placed.filter((mark) => mark.group === id).length}`).join(", ");
      console.log(
        `  ${era.foreign.label.padEnd(8)} ${String(placed.length).padStart(5)} of ${String(candidates).padStart(5)} marks`
        + ` (${byGroup})  ${megabytes([...nativeIds, ...foreignIds])} MB with the Russian`
        + `\n  share    ${pools.map((share) => `${Math.round(share * 100)}%`.padStart(4)).join(" ")}`,
      );
    }
  }
  console.log(`\npreset library: ${(([...bytes.values()].reduce((a, b) => a + b, 0)) / 1024 / 1024).toFixed(2)} MB across ${groupsBuilt.length} groups`);

  const sheetIndex = process.argv.indexOf("--sheet");
  if (sheetIndex < 0) return;
  const directory = process.argv[sheetIndex + 1] ?? path.join(root, "proof");
  await mkdir(directory, { recursive: true });
  for (const era of erasBuilt) {
    console.log(await proofSheet(era.id, era.nativeLevels, era.peak, directory));
    if (era.foreign) {
      const mixed = era.nativeLevels.map((level, index) => [...level, ...era.foreign.levels[index]]);
      console.log(await proofSheet(era.foreign.id, mixed, era.peak, directory));
    }
  }
}

await main();
