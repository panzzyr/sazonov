import { brotliCompressSync, gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const homepage = path.join(root, "apps/site/_site/index.html");
const html = await readFile(homepage);
const gzip = gzipSync(html, { level: 9 });
const brotli = brotliCompressSync(html);
const text = html.toString();
// /theme.js is the one allowed blocking request: it has to stamp the stored
// theme on <html> before the first paint, so it cannot be deferred. Everything
// else must still be inline.
const themeScript = /<script\b[^>]*\bsrc=["']\/theme\.js["'][^>]*><\/script>/gi;
const themeRequests = [...text.matchAll(themeScript)].length;
const blockingRequests = [
  ...text.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi),
  ...text.replace(themeScript, "").matchAll(/<script\b[^>]*src=/gi),
  ...text.matchAll(/<img\b[^>]*(?:fetchpriority=["']high["']|loading=["']eager["'])[^>]*>/gi),
].length;

console.table([{
  page: "/",
  raw: html.byteLength,
  gzip: gzip.byteLength,
  brotli: brotli.byteLength,
  "first-paint requests": blockingRequests + themeRequests + 1,
}]);

const limit = 14_336;
if (brotli.byteLength >= limit) {
  console.error(`Homepage exceeds the ${limit}-byte Brotli budget.`);
  process.exitCode = 1;
}
if (blockingRequests > 0) {
  console.error("Homepage contains blocking external resources.");
  process.exitCode = 1;
}
