// Copies each built tool into the portfolio output at its own sub-path.
//
// Everything ships from one repository and one Pages deployment: the portfolio
// occupies the root and the tools live underneath it. Each tool is built with
// its own base ("/printor/", "/glyph-art/"), so their asset URLs already point
// at these locations.

import { cp, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = path.join(root, "apps/site/_site");

const tools = [
  { name: "printor", dist: "apps/printor/dist" },
  { name: "glyph-art", dist: "apps/glyph-art/dist" },
];

try {
  await stat(output);
} catch {
  throw new Error("apps/site/_site is missing. Build the site before nesting the tools.");
}

for (const tool of tools) {
  const source = path.join(root, tool.dist);
  try {
    await stat(source);
  } catch {
    throw new Error(`${tool.dist} is missing. Build ${tool.name} before nesting it.`);
  }

  // The site build wipes _site, so this always runs last and starts clean.
  const target = path.join(output, tool.name);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
  await stat(path.join(target, "index.html"));
  console.log(`Nested ${tool.name} into apps/site/_site/${tool.name}/`);
}
