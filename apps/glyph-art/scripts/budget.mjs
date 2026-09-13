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

// The preset sheets are the one thing this tool loads off the network after
// the bundle, and the only part of it that can grow without anybody noticing.
//
// Two ceilings, because they answer different questions. A preset's sheets are
// fetched only when it is picked, so what a visitor actually downloads is *one
// preset* — the sheets of all the groups it draws on, which for a foreign
// preset is its era's Russian sheets as well as the foreign ones. That is the
// number to watch when an era gains pages. The total is what the repository
// and the deployment carry, and it is the one to watch when an era is added.
//
// The ceilings are set by eras that print every Russian mark they have — up to
// seven thousand from one dense page. Growing them further is a decision about
// what a visitor waits for, not a number to nudge until the build passes.
const presetRoot = path.join(output, "presets");
const perPresetLimit = 6 * 1024 * 1024;
const totalLimit = 16 * 1024 * 1024;

const groupBytes = new Map();
for (const group of await readdir(presetRoot)) {
  let bytes = 0;
  for (const name of await readdir(path.join(presetRoot, group))) {
    bytes += (await readFile(path.join(presetRoot, group, name))).byteLength;
  }
  groupBytes.set(group, bytes);
}

// Which groups each preset draws on, read off the generated module rather than
// imported, so this runs on a Node without TypeScript support.
const module = await readFile(path.join(process.cwd(), "src/generatedPresets.ts"), "utf8");
const presets = [];
for (const block of module.slice(module.indexOf("export const presetEras")).split(/\n {2}\{\n/).slice(1)) {
  const id = /id: "([^"]+)"/.exec(block)?.[1];
  const native = /native: \{\n\s+groups: (\[[^\]]*\])/.exec(block);
  if (!id || !native) throw new Error("glyph art's budget could not read an era from generatedPresets.ts.");
  presets.push([id, JSON.parse(native[1])]);
  const foreign = /foreign: \{ id: "([^"]+)", label: "[^"]*", groups: (\[[^\]]*\])/.exec(block);
  if (foreign) presets.push([foreign[1], [...JSON.parse(native[1]), ...JSON.parse(foreign[2])]]);
}
if (presets.length === 0) throw new Error("glyph art's budget found no presets in generatedPresets.ts.");

for (const [id, groups] of presets) {
  const bytes = groups.reduce((sum, group) => {
    if (!groupBytes.has(group)) throw new Error(`preset "${id}" draws on "${group}", which has no sheets.`);
    return sum + groupBytes.get(group);
  }, 0);
  console.log(`  ${id.padEnd(34)} ${String(bytes).padStart(8)} bytes  ${groups.join(" + ")}`);
  if (bytes > perPresetLimit) {
    throw new Error(`preset "${id}" exceeds the ${perPresetLimit}-byte per-preset target.`);
  }
}

const presetBytes = [...groupBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
console.log(`glyph art preset sheets: ${presetBytes} bytes across ${groupBytes.size} groups`);
if (presetBytes > totalLimit) {
  throw new Error(`the preset library exceeds the ${totalLimit}-byte total target.`);
}

const html = await readFile(path.join(output, "index.html"), "utf8");
if (!html.includes("connect-src 'none'")) {
  throw new Error("glyph art CSP no longer prevents runtime connections.");
}
