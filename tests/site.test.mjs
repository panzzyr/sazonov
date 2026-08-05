import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const output = path.resolve("apps/site/_site");

async function page(url) {
  const relative = url === "/" ? "index.html" : `${url.replace(/^\/|\/$/g, "")}/index.html`;
  return readFile(path.join(output, relative), "utf8");
}

test("English and Russian core routes build", async () => {
  for (const route of ["/", "/posts/", "/projects/", "/tools/", "/about/", "/cv/", "/ru/", "/ru/posts/", "/ru/projects/", "/ru/tools/", "/ru/about/", "/ru/cv/"]) {
    const html = await page(route);
    assert.match(html, /<!doctype html>/i, route);
    assert.match(html, /<main id="content">/, route);
  }
});

test("homepages are self-contained and language-linked", async () => {
  const english = await page("/");
  const russian = await page("/ru/");
  assert.doesNotMatch(english, /<script\b/i);
  assert.doesNotMatch(english, /rel="stylesheet"/i);
  assert.match(english, /hreflang="ru"/);
  assert.match(russian, /hreflang="en"/);
});

test("published articles and project translations exist", async () => {
  await stat(path.join(output, "posts/why-this-site-weighs-14-kb/index.html"));
  await stat(path.join(output, "ru/posts/why-this-site-weighs-14-kb/index.html"));
  await stat(path.join(output, "projects/magnetic-breathers/index.html"));
  await stat(path.join(output, "ru/projects/magnetic-breathers/index.html"));
});

test("draft posts stay out of production", async () => {
  await assert.rejects(stat(path.join(output, "posts/what-a-breather-is/index.html")), { code: "ENOENT" });
});

test("metadata, CV, and discovery files build", async () => {
  for (const file of ["feed.xml", "ru/feed.xml", "sitemap.xml", "robots.txt", "404.html", "og.png", "cv.pdf", "_headers"]) {
    const info = await stat(path.join(output, file));
    assert.ok(info.size > 0, file);
  }
});

test("printor is nested under /printor/ and built for that sub-path", async () => {
  const html = await page("/printor/");
  // A root-absolute asset path here would 404 in production, which is the one
  // way this deployment shape breaks silently.
  assert.match(html, /src="\/printor\/assets\//, "printor script is not base-aware");
  assert.doesNotMatch(html, /src="\/assets\//, "printor emitted root-absolute assets");
  assert.match(html, /connect-src 'none'/, "printor lost its CSP");

  await stat(path.join(output, "printor/support/index.html"));
  await stat(path.join(output, "printor/textures/manifest.json"));

  const manifest = JSON.parse(await readFile(path.join(output, "printor/textures/manifest.json"), "utf8"));
  assert.ok(manifest.textures.length > 0, "texture library is empty");
  for (const texture of manifest.textures.slice(0, 5)) {
    await stat(path.join(output, "printor/textures", texture.file));
  }
});

test("the portfolio links printor at its deployed path", async () => {
  const html = await page("/tools/");
  assert.match(html, /href="\/printor\/"/);
});
