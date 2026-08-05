import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

async function sourceFiles(directory = sourceRoot): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) ? [file] : [];
  }));
  return files.flat();
}

/** Comments discuss the APIs we avoid, so only real code is scanned. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("local-only privacy boundary", () => {
  it("ships a CSP that prevents runtime connections", async () => {
    const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).not.toContain("analytics");
  });

  it("declares the same CSP in the document itself", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    expect(html).toContain("connect-src 'none'");
  });

  it("never calls a network API anywhere in the source", async () => {
    // connect-src 'none' would block these at runtime; failing here instead
    // keeps the reason visible rather than surfacing as a mystery console error.
    for (const file of await sourceFiles()) {
      const source = stripComments(await readFile(file, "utf8"));
      expect(source, path.basename(file)).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/);
    }
  });

  it("keeps frame variation on the seeded hash rather than Math.random", async () => {
    for (const file of await sourceFiles()) {
      const source = stripComments(await readFile(file, "utf8"));
      expect(source, path.basename(file)).not.toMatch(/Math\.random/);
    }
  });

  it("loads library textures from the app's own origin only", async () => {
    const cache = stripComments(await readFile(new URL("../src/engine/textureCache.ts", import.meta.url), "utf8"));
    expect(cache).toContain("import.meta.env.BASE_URL");
    expect(cache).not.toMatch(/https?:\/\//);
  });
});
