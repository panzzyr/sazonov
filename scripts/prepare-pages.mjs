// Turns a scanned page — a PDF, a JPEG, a PNG on paper — into ink on
// transparency, the one shape `harvest-glyphs.mjs` reads.
//
//   node scripts/prepare-pages.mjs <out-dir> <file> [--pages 1,4,9] [--dpi 300] [--masks]
//
// `--masks` takes a PDF page's embedded one-bit text mask instead of rendering
// it — for PDFs converted from DjVu, whose background layer renders as smudges.
//
// Writes one PNG per page into <out-dir>, named after the file and the page.
// A page that already has its background removed (a PNG with alpha) is copied
// across as it is.
//
// **PDFs are rendered, not mined.** Most newspaper PDFs are scans with an
// invisible layer of recognised text laid over them: the fonts in the file are
// that layer, and they print nothing. What is on the page is the scan, so the
// page is rendered as it looks — by poppler's `pdftoppm`, which has to be on the
// PATH (`brew install poppler`) — at the resolution of the scan inside it.
//
// **The background comes off by levels.** Paper is the most common light
// value on a page and ink is its darkest percentile; everything within a
// margin of the paper becomes transparent, everything within a margin of the
// ink becomes solid, and the rest is a ramp between them. That is what a
// levels adjustment does by eye, done per page from its own histogram, so a
// yellowed sheet and a clean one both come out as ink on nothing.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

/** Share of the paper-to-ink span that still counts as paper, and as ink. */
const PAPER_MARGIN = 0.14;
const INK_MARGIN = 0.12;

/**
 * Levels a greyscale page into an alpha mask: 0 on paper, 255 on ink.
 *
 * Paper is the histogram's mode among the lighter half — a page is mostly
 * paper, whatever colour it has gone. Ink is the 0.5th percentile, not the
 * minimum, so a single black speck or the scanner's edge does not set it.
 */
function levels(grey) {
  const counts = new Uint32Array(256);
  for (const value of grey) counts[value] += 1;

  let paper = 255;
  let most = -1;
  for (let value = 110; value < 256; value += 1) {
    if (counts[value] > most) {
      most = counts[value];
      paper = value;
    }
  }
  let seen = 0;
  let ink = 0;
  for (let value = 0; value < 256; value += 1) {
    seen += counts[value];
    if (seen >= grey.length * 0.005) {
      ink = value;
      break;
    }
  }

  const span = Math.max(24, paper - ink);
  const clear = paper - span * PAPER_MARGIN;
  const solid = ink + span * INK_MARGIN;
  const alpha = Buffer.alloc(grey.length);
  for (let index = 0; index < grey.length; index += 1) {
    const value = (clear - grey[index]) / (clear - solid);
    alpha[index] = Math.round(255 * Math.min(1, Math.max(0, value)));
  }
  return { alpha, paper, ink };
}

/** Writes an alpha mask as black ink on transparency. */
async function writeInk(alpha, width, height, file) {
  const black = await sharp({ create: { width, height, channels: 3, background: "#000000" } }).raw().toBuffer();
  await sharp(black, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toFile(file);
}

async function prepareImage(file, out) {
  const image = sharp(file);
  const meta = await image.metadata();
  if (meta.hasAlpha) {
    await sharp(file).png().toFile(out);
    return "already on transparency";
  }
  const { data, info } = await image.toColorspace("b-w").raw().toBuffer({ resolveWithObject: true });
  const grey = info.channels === 1 ? data : data.filter((_, index) => index % info.channels === 0);
  const { alpha, paper, ink } = levels(grey);
  await writeInk(alpha, info.width, info.height, out);
  return `paper ${paper}, ink ${ink}`;
}

/**
 * The largest one-bit image embedded in a PDF page, as dark ink on light paper.
 *
 * A PDF converted from DjVu keeps the text as a separate one-bit mask over a
 * coloured background layer; rendered, the two blend and the background turns
 * into grey smudges that harvest as marks. The mask alone is the type and
 * nothing else. It may come out inverted, so it is flipped if most of it is ink.
 */
async function extractMask(file, page, scratch) {
  const { stdout } = await run("pdfimages", ["-list", "-f", String(page), "-l", String(page), file]);
  const masks = stdout.split("\n").slice(2)
    .map((line) => line.trim().split(/\s+/))
    .filter((cells) => cells.length > 8 && cells[7] === "1")
    .map((cells) => ({ number: Number(cells[1]), area: Number(cells[3]) * Number(cells[4]) }))
    .sort((a, b) => b.area - a.area);
  if (masks.length === 0) return null;

  const prefix = path.join(scratch, `m${page}`);
  await run("pdfimages", ["-png", "-f", String(page), "-l", String(page), file, prefix], { maxBuffer: 1 << 26 });
  const name = `m${page}-${String(masks[0].number).padStart(3, "0")}.png`;
  const { data, info } = await sharp(path.join(scratch, name)).toColorspace("b-w").raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (const value of data) sum += value;
  const grey = sum / data.length < 128 ? Buffer.from(data.map((value) => 255 - value)) : data;
  const out = path.join(scratch, `mask-${page}.png`);
  await sharp(grey, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toFile(out);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const options = { pages: null, dpi: 300, masks: false };
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--pages") options.pages = args[++index].split(",").map(Number);
    else if (args[index] === "--dpi") options.dpi = Number(args[++index]);
    else if (args[index] === "--masks") options.masks = true;
    else positional.push(args[index]);
  }
  const [outDir, file] = positional;
  if (!outDir || !file) {
    throw new Error("usage: node scripts/prepare-pages.mjs <out-dir> <file> [--pages 1,4,9] [--dpi 300]");
  }
  await mkdir(outDir, { recursive: true });
  const stem = path.basename(file, path.extname(file))
    .normalize("NFKD").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

  if (!/\.pdf$/i.test(file)) {
    const out = path.join(outDir, `${stem}.png`);
    console.log(`${path.basename(out).padEnd(40)} ${await prepareImage(file, out)}`);
    return;
  }

  const { stdout } = await run("pdfinfo", [file]);
  const count = Number(/Pages:\s+(\d+)/.exec(stdout)?.[1] ?? 1);
  const pages = options.pages ?? Array.from({ length: count }, (_, index) => index + 1);
  const scratch = await mkdtemp(path.join(tmpdir(), "pages-"));
  try {
    for (const page of pages) {
      const out = path.join(outDir, `${stem}-p${String(page).padStart(3, "0")}.png`);
      const mask = options.masks ? await extractMask(file, page, scratch) : null;
      if (mask) {
        console.log(`${path.basename(out).padEnd(40)} mask, ${await prepareImage(mask, out)}`);
        continue;
      }
      const prefix = path.join(scratch, `p${page}`);
      await run("pdftoppm", ["-gray", "-png", "-r", String(options.dpi), "-f", String(page), "-l", String(page), file, prefix], { maxBuffer: 1 << 26 });
      const rendered = (await readdir(scratch)).find((name) => name.startsWith(`p${page}-`) || name === `p${page}.png`);
      console.log(`${path.basename(out).padEnd(40)} ${await prepareImage(path.join(scratch, rendered), out)}`);
      await rm(path.join(scratch, rendered));
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

await main();
