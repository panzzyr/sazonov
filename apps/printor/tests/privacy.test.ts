import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("local-only privacy boundary", () => {
  it("ships a CSP that prevents runtime connections", async () => {
    const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
    expect(headers).toContain("connect-src 'none'");
    expect(headers).not.toContain("analytics");
  });

  it("does not call network APIs from the application entry points", async () => {
    const sources = await Promise.all([
      "App.tsx",
      "main.tsx",
      "store.ts",
      "presetState.ts",
    ].map((name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8")));
    expect(sources.join("\n")).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  });
});
