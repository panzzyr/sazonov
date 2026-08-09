import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "dist");
const assets = path.join(output, "assets");
let gzipTotal = 0;

for (const name of await readdir(assets)) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  gzipTotal += gzipSync(await readFile(path.join(assets, name)), { level: 9 }).byteLength;
}

// No shader, no texture library: this build should sit far under printor's
// ceiling. Sharing the number keeps a regression obvious rather than gradual.
const limit = 300 * 1024;
console.log(`glyph art JS + CSS: ${gzipTotal} bytes gzip`);
if (gzipTotal > limit) throw new Error(`glyph art exceeds the ${limit}-byte gzip target.`);

const html = await readFile(path.join(output, "index.html"), "utf8");
if (!html.includes("connect-src 'none'")) {
  throw new Error("glyph art CSP no longer prevents runtime connections.");
}
