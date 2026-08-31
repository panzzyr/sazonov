// Cuts a scanned page into individual marks, ready for the preset builder.
//
//   node scripts/harvest-glyphs.mjs <set-id> <page.png> [more pages...]
//
// Writes candidate marks into assets/glyph-presets/<set-id>/, in exactly the
// shape a hand-picked scan arrives in — black ink on transparency, one mark per
// file — so `build-glyph-presets.mjs` cannot tell the difference and does not
// need to. Harvesting answers "what marks are on this page"; the builder still
// answers "which of them prints on which level".
//
// **No machine vision here, and none is needed.** A cleaned letterpress page is
// ink on transparency, so a letter is literally a connected island of alpha.
// Labelling those islands is a two-pass flood with a union-find — 1970s
// morphology, a tenth of a second for a ten-megapixel page, and exactly
// reproducible. What a model would add is a *name* for each letter, and the
// tool never needs one: it sizes marks by measured ink, not by identity.
//
// Four filters stand between six thousand islands and a usable set.
//
//   size      — under ~14 px is a speck of scanner noise or a full stop; over a
//               few hundred is a rule, a border or the masthead.
//   fill      — an island that inks under a tenth of its own bounding box is a
//               frame or a stray hairline, not a mark.
//   crispness — a letter pressed into paper is nearly all ink or nearly all
//               paper, with a pixel of transition. A stain, a show-through or
//               the ghost of a fold is *all* transition, and is otherwise
//               indistinguishable from type by size or shape. This is the
//               filter that catches the rubbish nothing else can see.
//   recurrence— an island whose shape appears at least a few times on the page
//               is a sort in the fount. One that appears once is a tear or two
//               words fused by a heavy impression — unless it is large, which
//               is the second, independent proof that it was set deliberately.
//
// Everything that survives is written out. Choosing among them is the builder's
// job, because "which mark belongs on which level" cannot be answered without
// the ramp, and the ramp cannot be solved until every candidate is measured.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputRoot = path.join(root, "assets/glyph-presets");

/** Alpha above this counts as ink. Low, so anti-aliased edges stay attached. */
const INK = 40;

/** Islands outside this box are noise at one end and furniture at the other. */
const MIN_EDGE = 14;
const MAX_EDGE = 420;

/**
 * A mark wider than this relative to its height is a fragment of a line.
 *
 * It is not excluded for being ugly — the ramp handles it correctly, and puts
 * it where it belongs. A mark is fitted into its square cell by its *long*
 * side, so a mark 2.5 times as wide as it is tall reaches only two fifths of
 * the cell vertically and inks two fifths of what its own density suggests.
 * The solver reads that as a light mark and sorts it onto a light level, which
 * is correct. Past this ratio it prints so small that it stops being a mark and
 * becomes a dash.
 */
const MAX_ASPECT = 2.5;

/** An island inking less of its own box than this is a frame, not a mark. */
const MIN_FILL = 0.12;

/**
 * Fraction of an island's inked pixels that must be *solidly* inked.
 *
 * The one filter the geometry cannot supply. A page carries, alongside its
 * type, a quantity of soft grey rubbish: show-through from the far side of the
 * leaf, a thumbprint, the ghost of a fold, the halo left where a stain was
 * cleaned away. These pass every size, proportion and fill test — some are
 * exactly letter-sized and letter-shaped — and they print as mud.
 *
 * What separates them from type is not shape but *edge*. A letter pressed into
 * paper is bimodal: almost every pixel is either ink or paper, with a pixel or
 * two of transition. A stain is all transition. Counting the pixels at full
 * strength as a fraction of the pixels with any ink at all separates the two
 * cleanly, and the threshold is not delicate — below 0.2 is uniformly rubbish,
 * above 0.35 is uniformly type, and there is very little in between.
 */
const MIN_CRISP = 0.33;

/** Thumbnail edge used for the shape signature. */
const SIGNATURE = 16;

/**
 * How alike two thumbnails have to be to count as the same letterform, as RMS
 * difference over the signature. Loose enough to see through a heavy or a
 * starved impression of the same sort, tight enough to keep O and 0 apart.
 */
const SAME = 0.16;

/** Shapes appearing fewer times than this on a page are not the fount. */
const MIN_RECURRENCE = 3;

/**
 * An island at least this large on its short side is kept whether it recurs or
 * not.
 *
 * Recurrence proves an island is a sort in the fount, but the proof is only
 * available for text that was set more than once. A masthead, a headline or an
 * ornament is set once on the page and would fail the test while being the
 * cleanest, most deliberate mark on it. Size is the second, independent proof:
 * scanner dirt and torn fibres are small, and nothing this large survives the
 * fill and proportion filters without being type.
 */
const LARGE_EDGE = 36;

/** Long side of a written mark. Marks print at 24 px, so this is ample. */
const WRITE_EDGE = 160;

/* --------------------------------------------------------------- labelling */

/**
 * Labels every connected island of ink, 8-connected.
 *
 * The classic two-pass: one raster scan assigning provisional labels and
 * recording equivalences, then a resolve. 8-connected rather than 4 because a
 * letterpress serif meets its stem diagonally as often as not, and 4-connectivity
 * would shear the serifs off.
 */
function label(alpha, width, height) {
  const labels = new Int32Array(width * height);
  // One provisional label per run start; a page of this size never approaches
  // a million, and growing the array would cost more than over-allocating it.
  const parent = new Int32Array(Math.max(1024, Math.ceil((width * height) / 4)));
  let next = 1;

  const find = (value) => {
    let node = value;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alpha[index] <= INK) continue;

      let best = 0;
      for (const [dx, dy] of [[-1, 0], [-1, -1], [0, -1], [1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width) continue;
        const neighbour = labels[ny * width + nx];
        if (!neighbour) continue;
        if (!best) best = neighbour;
        else union(best, neighbour);
      }

      if (!best) {
        best = next;
        parent[best] = best;
        next += 1;
      }
      labels[index] = best;
    }
  }

  return { labels, find };
}

/** Bounding box and ink of every island, keyed by its resolved label. */
function islands(alpha, width, height) {
  const { labels, find } = label(alpha, width, height);
  const boxes = new Map();

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = labels[y * width + x];
      if (!value) continue;
      const key = find(value);
      let box = boxes.get(key);
      if (!box) {
        box = { left: x, right: x, top: y, bottom: y, pixels: 0, ink: 0 };
        boxes.set(key, box);
      }
      if (x < box.left) box.left = x;
      if (x > box.right) box.right = x;
      if (y < box.top) box.top = y;
      if (y > box.bottom) box.bottom = y;
      box.pixels += 1;
      box.ink += alpha[y * width + x] / 255;
    }
  }

  return boxes;
}

/**
 * A shape thumbnail, box-averaged from the island's tight box.
 *
 * Stretched to a square rather than letterboxed: proportion is carried
 * separately, and normalising it out is what lets a wide impression of a sort
 * match a narrow one of the same sort.
 */
function signature(alpha, width, box) {
  const boxWidth = box.right - box.left + 1;
  const boxHeight = box.bottom - box.top + 1;
  const thumb = new Float32Array(SIGNATURE * SIGNATURE);

  for (let cellY = 0; cellY < SIGNATURE; cellY += 1) {
    const top = box.top + Math.floor((cellY * boxHeight) / SIGNATURE);
    const bottom = Math.max(top + 1, box.top + Math.floor(((cellY + 1) * boxHeight) / SIGNATURE));
    for (let cellX = 0; cellX < SIGNATURE; cellX += 1) {
      const left = box.left + Math.floor((cellX * boxWidth) / SIGNATURE);
      const right = Math.max(left + 1, box.left + Math.floor(((cellX + 1) * boxWidth) / SIGNATURE));
      let sum = 0;
      let samples = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          sum += alpha[y * width + x] / 255;
          samples += 1;
        }
      }
      thumb[cellY * SIGNATURE + cellX] = sum / (samples || 1);
    }
  }

  return thumb;
}

/**
 * Share of an island's ink that sits at full strength rather than in the
 * transition between ink and paper.
 */
function crispness(alpha, width, box) {
  let inked = 0;
  let solid = 0;
  for (let y = box.top; y <= box.bottom; y += 1) {
    for (let x = box.left; x <= box.right; x += 1) {
      const value = alpha[y * width + x];
      if (value <= INK) continue;
      inked += 1;
      if (value > 191) solid += 1;
    }
  }
  return inked ? solid / inked : 0;
}

export function signatureDistance(a, b) {
  let total = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index] - b[index];
    total += delta * delta;
  }
  return Math.sqrt(total / a.length);
}

/* ------------------------------------------------------------- recurrence */

/**
 * Counts how many islands share each island's shape.
 *
 * Comparing every pair would be several million distances on a broadsheet, so
 * candidates are bucketed by proportion and density and each one is compared
 * only against nearby buckets.
 *
 * The neighbourhood is the whole point, and getting it wrong is silent. Two
 * impressions of the same sort differ slightly in ink, so one can land at
 * density 0.249 and the next at 0.251 — a bucket edge between them. Searching
 * only the home bucket therefore reports that neither recurs, and every letter
 * on the page looks like a one-off smudge. Widening the search to the
 * surrounding buckets costs nine lookups and fixes it.
 */
function countRecurrence(candidates) {
  const buckets = new Map();
  const key = (aspect, density) => `${aspect}|${density}`;
  const coords = (candidate) => [
    Math.round(Math.log(candidate.aspect) * 6),
    Math.round(candidate.density * 10),
  ];

  for (const candidate of candidates) {
    const [aspect, density] = coords(candidate);
    const id = key(aspect, density);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(candidate);
  }

  for (const candidate of candidates) {
    const [aspect, density] = coords(candidate);
    candidate.recurrence = 0;
    for (let da = -1; da <= 1; da += 1) {
      for (let dd = -1; dd <= 1; dd += 1) {
        for (const other of buckets.get(key(aspect + da, density + dd)) ?? []) {
          if (signatureDistance(candidate.signature, other.signature) < SAME) {
            candidate.recurrence += 1;
          }
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ pages */

async function harvest(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;

  const candidates = [];
  for (const box of islands(data, width, height).values()) {
    const boxWidth = box.right - box.left + 1;
    const boxHeight = box.bottom - box.top + 1;
    const longest = Math.max(boxWidth, boxHeight);
    const shortest = Math.min(boxWidth, boxHeight);
    if (shortest < MIN_EDGE || longest > MAX_EDGE) continue;

    const aspect = boxWidth / boxHeight;
    if (Math.max(aspect, 1 / aspect) > MAX_ASPECT) continue;

    const density = box.ink / (boxWidth * boxHeight);
    if (density < MIN_FILL) continue;

    const crisp = crispness(data, width, box);
    if (crisp < MIN_CRISP) continue;

    candidates.push({
      box,
      width: boxWidth,
      height: boxHeight,
      aspect,
      density,
      crisp,
      signature: signature(data, width, box),
    });
  }

  countRecurrence(candidates);
  const kept = candidates.filter(
    (candidate) => candidate.recurrence >= MIN_RECURRENCE
      || Math.min(candidate.width, candidate.height) >= LARGE_EDGE,
  );
  return { width, height, data, pageWidth: width, candidates, kept };
}

/** Writes one island out as a mark: black ink, alpha carrying the impression. */
async function write(page, candidate, file) {
  const { box, width: boxWidth, height: boxHeight } = candidate;
  const alpha = Buffer.alloc(boxWidth * boxHeight);
  for (let y = 0; y < boxHeight; y += 1) {
    for (let x = 0; x < boxWidth; x += 1) {
      alpha[y * boxWidth + x] = page.data[(box.top + y) * page.pageWidth + (box.left + x)];
    }
  }

  const black = await sharp({
    create: { width: boxWidth, height: boxHeight, channels: 3, background: "#000000" },
  }).raw().toBuffer();

  await sharp(black, { raw: { width: boxWidth, height: boxHeight, channels: 3 } })
    .joinChannel(alpha, { raw: { width: boxWidth, height: boxHeight, channels: 1 } })
    .resize({
      width: WRITE_EDGE,
      height: WRITE_EDGE,
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    })
    .png()
    .toFile(file);
}

async function main() {
  const [set, ...pages] = process.argv.slice(2);
  if (!set || pages.length === 0) {
    throw new Error("usage: node scripts/harvest-glyphs.mjs <set-id> <page.png> [pages...]");
  }

  const directory = path.join(outputRoot, set);
  // Harvesting is not additive: re-running it on a changed page list should
  // leave the set as the pages describe it, not as the union of every run.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const manifest = [];
  let written = 0;

  for (const page of pages) {
    const started = Date.now();
    const result = await harvest(page);
    const stem = path.basename(page, path.extname(page)).replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    let index = 0;
    for (const candidate of result.kept) {
      index += 1;
      const name = `${stem}-${String(index).padStart(4, "0")}.png`;
      await write(result, candidate, path.join(directory, name));
      manifest.push({
        file: name,
        page: path.basename(page),
        box: [candidate.box.left, candidate.box.top, candidate.width, candidate.height],
        density: Number(candidate.density.toFixed(4)),
        aspect: Number(candidate.aspect.toFixed(4)),
        crisp: Number(candidate.crisp.toFixed(3)),
        recurrence: candidate.recurrence,
      });
      written += 1;
    }

    console.log(
      `${path.basename(page).padEnd(24)} ${result.width}x${result.height}`
      + `  islands ${String(result.candidates.length).padStart(5)}`
      + `  kept ${String(result.kept.length).padStart(5)}`
      + `  ${Date.now() - started}ms`,
    );
  }

  await writeFile(
    path.join(directory, "harvest.json"),
    `${JSON.stringify({ set, pages, written, marks: manifest }, null, 1)}\n`,
    "utf8",
  );

  const files = (await readdir(directory)).filter((name) => name.endsWith(".png"));
  console.log(`\n${set}: ${files.length} candidate marks in assets/glyph-presets/${set}/`);
  console.log("Now run: node scripts/build-glyph-presets.mjs");
}

await main();
