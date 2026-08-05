// Copies the built printor app into the portfolio output at /printor/.
//
// Both sites ship from one repository and one Pages deployment: the portfolio
// occupies the root and printor lives underneath it. printor is built with
// base "/printor/", so its own asset URLs already point at this location.

import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = path.join(root, "apps/printor/dist");
const target = path.join(root, "apps/site/_site/printor");

try {
  await stat(source);
} catch {
  throw new Error("apps/printor/dist is missing. Build printor before nesting it.");
}

try {
  await stat(path.join(root, "apps/site/_site"));
} catch {
  throw new Error("apps/site/_site is missing. Build the site before nesting printor.");
}

// The site build wipes _site, so this always runs last and starts clean.
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });

const html = path.join(target, "index.html");
await stat(html);
console.log("Nested printor into apps/site/_site/printor/");
