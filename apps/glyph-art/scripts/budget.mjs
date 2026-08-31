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

// The preset marks are the one thing this tool loads off the network after the
// bundle, and the only part of it that can grow without anybody noticing.
//
// Two ceilings, because they answer different questions. A set is fetched only
// when it is picked, so what a visitor actually downloads is *one set* — that
// is the number that has to stay small, and it is the one to watch when a set
// gains marks. The total is what the repository and the deployment carry, and
// it is the one to watch when a set is added.
const presetRoot = path.join(output, "presets");
const perSetLimit = 160 * 1024;
const totalLimit = 512 * 1024;
let presetBytes = 0;
let presetCount = 0;

for (const set of await readdir(presetRoot)) {
  let bytes = 0;
  let count = 0;
  for (const name of await readdir(path.join(presetRoot, set))) {
    bytes += (await readFile(path.join(presetRoot, set, name))).byteLength;
    count += 1;
  }
  console.log(`  ${set.padEnd(22)} ${String(bytes).padStart(7)} bytes  ${count} marks`);
  if (bytes > perSetLimit) {
    throw new Error(`preset "${set}" exceeds the ${perSetLimit}-byte per-set target.`);
  }
  presetBytes += bytes;
  presetCount += count;
}

console.log(`glyph art preset marks: ${presetBytes} bytes across ${presetCount} files`);
if (presetBytes > totalLimit) {
  throw new Error(`the preset library exceeds the ${totalLimit}-byte total target.`);
}

const html = await readFile(path.join(output, "index.html"), "utf8");
if (!html.includes("connect-src 'none'")) {
  throw new Error("glyph art CSP no longer prevents runtime connections.");
}
