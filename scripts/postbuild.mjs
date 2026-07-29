import { brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(root, "apps/site/_site");
const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

const ogSvg = Buffer.from(`
  <svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="630" fill="#F2F1EE"/>
    <rect x="88" y="80" width="104" height="104" fill="#17181A"/>
    <text x="140" y="154" text-anchor="middle" font-family="Arial" font-size="66" font-weight="700" fill="#F2F1EE">S</text>
    <text x="88" y="352" font-family="Arial" font-size="76" font-weight="600" fill="#17181A">Stepan Sazonov</text>
    <text x="88" y="414" font-family="Courier New" font-size="25" letter-spacing="3" fill="#74777B">COMPUTATIONAL PHYSICS · R&amp;D · TOOLS</text>
    <line x1="88" x2="1112" y1="505" y2="505" stroke="#17181A" stroke-width="2"/>
  </svg>`);
await sharp(ogSvg).png().toFile(path.join(output, "og.png"));

const cvSource = path.join(root, "docs/main.pdf");
try {
  await copyFile(cvSource, path.join(output, "cv.pdf"), constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code !== "ENOENT" && error.code !== "EEXIST") throw error;
}

async function compressDirectory(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(file);
    } else if (/\.(?:html|css|js|svg|xml|txt)$/.test(entry.name)) {
      const content = await readFile(file);
      await Promise.all([
        writeFile(`${file}.gz`, await gzipAsync(content, { level: 9 })),
        writeFile(`${file}.br`, await brotliAsync(content)),
      ]);
    }
  }
}

await mkdir(output, { recursive: true });
await compressDirectory(output);
