import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(root, "apps/printor/dist");
const assets = path.join(output, "assets");
const rows = [];
let gzipTotal = 0;

for (const name of await readdir(assets)) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  const content = await readFile(path.join(assets, name));
  const gzip = gzipSync(content, { level: 9 }).byteLength;
  gzipTotal += gzip;
  rows.push({ asset: name, raw: content.byteLength, gzip });
}

console.table(rows);
console.log(`printor JS + CSS: ${gzipTotal} bytes gzip`);

const limit = 300 * 1024;
if (gzipTotal > limit) {
  console.error(`printor exceeds the ${limit}-byte gzip target.`);
  process.exitCode = 1;
}

const headers = await readFile(path.join(output, "_headers"), "utf8");
if (!headers.includes("connect-src 'none'")) {
  console.error("printor CSP no longer prevents network connections.");
  process.exitCode = 1;
}
