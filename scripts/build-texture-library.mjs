// Converts the full-resolution source scans in <root>/assets/ into the web
// texture library committed under apps/printor/public/textures/.
//
// Source originals stay out of git; only the converted WebP files and the
// manifest are committed, so printor deploys as a self-contained static site.
//
//   node scripts/build-texture-library.mjs [--force]

import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = path.join(root, "assets");
const outputRoot = path.join(root, "apps/printor/public/textures");
const force = process.argv.includes("--force");

const MAX_EDGE = 2048;
const QUALITY = 80;

/**
 * `kind` drives how printor uses the texture:
 *   paper   — multiplied/overlaid stock, opaque
 *   grunge  — harder stock, doubles as the displacement map source
 *   cutout  — torn paper shapes used as alpha masks, alpha preserved
 */
const groups = [
  {
    id: "soft-paper",
    kind: "paper",
    label: "soft paper",
    directories: [
      { from: "soft paper texture/white papers", tone: "light" },
      { from: "soft paper texture/black pappers", tone: "dark" },
    ],
  },
  {
    id: "hard-paper",
    kind: "grunge",
    label: "hard paper",
    directories: [{ from: "hard paper texture", tone: "dark" }],
  },
  {
    id: "paper-parts",
    kind: "cutout",
    label: "paper part",
    directories: [{ from: "paper parts", tone: "mask" }],
  },
];

function slug(value) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function listImages(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp|tiff?)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function convert(sourceFile, targetFile, kind) {
  // Cutouts are consumed purely as masks, so the paper's own colour is dead
  // weight: flatten each one to its alpha channel as a single-channel image.
  // That is roughly a tenth of the bytes of the equivalent RGBA WebP.
  const base = kind === "cutout" && (await sharp(sourceFile).metadata()).hasAlpha
    ? sharp(sourceFile).ensureAlpha().extractChannel("alpha")
    : sharp(sourceFile).rotate().flatten({ background: "#ffffff" }).grayscale();

  const info = await base
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .toColourspace("b-w")
    .webp({ quality: QUALITY, effort: 5 })
    .toFile(targetFile);

  return { width: info.width, height: info.height, bytes: info.size };
}

async function main() {
  try {
    await stat(sourceRoot);
  } catch {
    console.error(`No source directory at ${sourceRoot}. Nothing to convert.`);
    process.exitCode = 1;
    return;
  }

  if (force) await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  const textures = [];
  let totalBytes = 0;
  let converted = 0;
  let reused = 0;

  for (const group of groups) {
    const groupDirectory = path.join(outputRoot, group.id);
    await mkdir(groupDirectory, { recursive: true });
    let index = 0;

    for (const directory of group.directories) {
      const sourceDirectory = path.join(sourceRoot, directory.from);
      const files = await listImages(sourceDirectory);
      if (!files.length) {
        console.warn(`  (empty) ${directory.from}`);
        continue;
      }

      for (const file of files) {
        index += 1;
        const name = `${slug(directory.tone === "mask" ? "part" : directory.tone)}-${String(index).padStart(2, "0")}`;
        const relative = `${group.id}/${name}.webp`;
        const targetFile = path.join(outputRoot, relative);
        const sourceFile = path.join(sourceDirectory, file);

        let info;
        const existing = force ? null : await stat(targetFile).catch(() => null);
        if (existing) {
          const metadata = await sharp(targetFile).metadata();
          info = { width: metadata.width, height: metadata.height, bytes: existing.size };
          reused += 1;
        } else {
          info = await convert(sourceFile, targetFile, group.kind);
          converted += 1;
        }

        totalBytes += info.bytes;
        textures.push({
          id: `${group.id}-${name}`,
          name: `${group.label} ${String(index).padStart(2, "0")}`,
          group: group.id,
          kind: group.kind,
          tone: directory.tone,
          file: relative,
          width: info.width,
          height: info.height,
        });
      }
    }
    console.log(`${group.id}: ${textures.filter((item) => item.group === group.id).length} textures`);
  }

  const manifest = {
    generated: "scripts/build-texture-library.mjs",
    maxEdge: MAX_EDGE,
    quality: QUALITY,
    groups: groups.map(({ id, kind, label }) => ({ id, kind, label })),
    textures,
  };
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const megabytes = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`\n${textures.length} textures · ${megabytes} MB · ${converted} converted, ${reused} reused`);

  if (totalBytes > 64 * 1024 * 1024) {
    console.error("Texture library exceeds the 64 MB ceiling for a static deployment.");
    process.exitCode = 1;
  }
}

await main();
