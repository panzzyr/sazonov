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

const limit = 300 * 1024;
console.log(`printor JS + CSS: ${gzipTotal} bytes gzip`);
if (gzipTotal > limit) throw new Error(`printor exceeds the ${limit}-byte gzip target.`);

const html = await readFile(path.join(output, "index.html"), "utf8");
if (!html.includes("connect-src 'none'")) {
  throw new Error("printor CSP no longer prevents runtime connections.");
}
