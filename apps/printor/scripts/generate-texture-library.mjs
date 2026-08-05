// Bakes public/textures/manifest.json into a TypeScript module.
//
// printor ships a CSP with connect-src 'none', so the app cannot fetch its own
// manifest at runtime. Compiling it into the bundle keeps the library available
// with zero network access; the images themselves load through <img>, which the
// img-src 'self' directive permits.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestFile = path.join(root, "public/textures/manifest.json");
const outputFile = path.join(root, "src/generatedTextures.ts");

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  manifest = { groups: [], textures: [] };
  console.warn("No texture manifest found; generating an empty library.");
}

if (!Array.isArray(manifest.textures) || !Array.isArray(manifest.groups)) {
  throw new Error("textures/manifest.json must contain groups and textures arrays.");
}

const groupIds = new Set(manifest.groups.map((group) => group.id));

for (const texture of manifest.textures) {
  if (!texture.id || !texture.name || !texture.file || !groupIds.has(texture.group)) {
    throw new Error(`Texture ${texture.id ?? "?"} is missing id, name, file, or a known group.`);
  }
  if (texture.file.includes("..") || path.isAbsolute(texture.file)) {
    throw new Error(`Unsafe texture path: ${texture.file}`);
  }
}

const source = `// Generated from public/textures/manifest.json by
// scripts/generate-texture-library.mjs. Do not edit by hand.

export type TextureKind = "paper" | "grunge" | "cutout";

export type TextureGroup = {
  id: string;
  kind: TextureKind;
  label: string;
};

export type TextureEntry = {
  id: string;
  name: string;
  group: string;
  kind: TextureKind;
  tone: string;
  file: string;
  width: number;
  height: number;
};

export const textureGroups: TextureGroup[] = ${JSON.stringify(manifest.groups, null, 2)};

export const textureLibrary: TextureEntry[] = ${JSON.stringify(manifest.textures, null, 2)};

export const texturesByGroup = new Map<string, TextureEntry[]>(
  textureGroups.map((group) => [
    group.id,
    textureLibrary.filter((texture) => texture.group === group.id),
  ]),
);

export const textureById = new Map<string, TextureEntry>(
  textureLibrary.map((texture) => [texture.id, texture]),
);
`;

await writeFile(outputFile, source);
console.log(`Generated ${manifest.textures.length} textures into src/generatedTextures.ts`);
