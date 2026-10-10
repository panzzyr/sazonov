import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "dist");
const assets = path.join(output, "assets");
let gzipTotal = 0;
const groupBytes = new Map();

for (const name of await readdir(assets)) {
  if (!/\.(?:js|css)$/.test(name)) continue;
  const raw = await readFile(path.join(assets, name));
  const gzip = gzipSync(raw, { level: 9 }).byteLength;
  const vector = /^glyph-vectors-(.+)-[\w-]{8}\.js$/.exec(name);
  if (vector) groupBytes.set(vector[1], { raw: raw.byteLength, gzip });
  else gzipTotal += gzip;
}

// No shader, no texture library: this build should sit far under printor's
// ceiling. Sharing the number keeps a regression obvious rather than gradual.
const limit = 300 * 1024;
console.log(`glyph art JS + CSS: ${gzipTotal} bytes gzip`);
if (gzipTotal > limit) throw new Error(`glyph art exceeds the ${limit}-byte gzip target.`);

// Lazy vector data is artwork, not application code. Audit both uncompressed
// hosting footprint and compressed transfer; the initial JS budget stays 300KB.
// Supersedes the raster-sheet budgets (ADR 2026-10-10).
const perPresetLimit = 10 * 1024 * 1024;
const perPresetGzipLimit = 4 * 1024 * 1024;
const totalLimit = 48 * 1024 * 1024;
const totalGzipLimit = 16 * 1024 * 1024;

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
// The separate owner-curated collection is not a harvested historical era.
presets.push(["church-slavonic-vedomosti", ["church-slavonic-vedomosti"]]);

for (const [id, groups] of presets) {
  const size = groups.reduce((sum, group) => {
    if (!groupBytes.has(group)) throw new Error(`preset "${id}" draws on "${group}", which has no vectors.`);
    const { raw, gzip } = groupBytes.get(group);
    return { raw: sum.raw + raw, gzip: sum.gzip + gzip };
  }, { raw: 0, gzip: 0 });
  console.log(`  ${id.padEnd(34)} ${String(size.raw).padStart(8)} bytes; ${size.gzip} gzip`);
  if (size.raw > perPresetLimit || size.gzip > perPresetGzipLimit) {
    throw new Error(`preset "${id}" exceeds its raw or gzip artwork budget.`);
  }
}

const presetBytes = [...groupBytes.values()].reduce((sum, size) => sum + size.raw, 0);
const presetGzip = [...groupBytes.values()].reduce((sum, size) => sum + size.gzip, 0);
console.log(`glyph art vectors: ${presetBytes} bytes; ${presetGzip} gzip across ${groupBytes.size} groups`);
if (groupBytes.size !== 27) throw new Error("Incomplete vector catalogue; update this guard when adding a group.");
if (presetBytes > totalLimit || presetGzip > totalGzipLimit) {
  throw new Error("the vector library exceeds its raw or gzip artwork budget.");
}

const html = await readFile(path.join(output, "index.html"), "utf8");
if (!html.includes("connect-src 'none'")) {
  throw new Error("glyph art CSP no longer prevents runtime connections.");
}
