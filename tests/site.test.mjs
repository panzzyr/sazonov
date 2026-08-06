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
  for (const route of ["/", "/about/", "/ru/", "/ru/about/"]) {
    const html = await page(route);
    assert.match(html, /<!doctype html>/i, route);
    assert.match(html, /<main id="content">/, route);
  }
});

test("the site stays down to a home page and an about page", async () => {
  for (const route of ["/posts/", "/projects/", "/tools/", "/cv/", "/ru/posts/", "/ru/projects/", "/ru/tools/", "/ru/cv/"]) {
    await assert.rejects(page(route), { code: "ENOENT" }, `${route} should no longer build`);
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

test("both about pages carry the outside links and the CV", async () => {
  for (const route of ["/about/", "/ru/about/"]) {
    const html = await page(route);
    assert.match(html, /https:\/\/kmbnt\.ru/, route);
    assert.match(html, /https:\/\/victim\.team/, route);
    assert.match(html, /href="\/cv\.pdf"/, route);
    assert.match(html, /href="\/printor\/"/, route);
  }
});

test("metadata, CV, and discovery files build", async () => {
  for (const file of ["sitemap.xml", "robots.txt", "404.html", "og.png", "cv.pdf", "_headers", "CNAME"]) {
    const info = await stat(path.join(output, file));
    assert.ok(info.size > 0, file);
  }
});

test("the custom domain is what Pages will serve", async () => {
  const cname = await readFile(path.join(output, "CNAME"), "utf8");
  assert.equal(cname.trim(), "sazonov.space");
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

test("every page links printor at its deployed path", async () => {
  for (const route of ["/", "/about/", "/ru/", "/ru/about/"]) {
    const html = await page(route);
    assert.match(html, /href="\/printor\/"/, route);
  }
});
