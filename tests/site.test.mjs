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

test("the tools and articles sections build in both languages", async () => {
  for (const route of [
    "/tools/",
    "/ru/tools/",
    "/articles/",
    "/ru/articles/",
    "/articles/printor/",
    "/ru/articles/printor/",
    "/articles/glyph-art/",
    "/ru/articles/glyph-art/",
  ]) {
    const html = await page(route);
    assert.match(html, /<!doctype html>/i, route);
    assert.match(html, /<main id="content">/, route);
  }
});

test("the site stays down to home, about, tools, and articles", async () => {
  // `/tools/` and `/ru/tools/` were dropped from this list on purpose: the
  // restructure gives tools their own section again.
  for (const route of ["/posts/", "/projects/", "/cv/", "/ru/posts/", "/ru/projects/", "/ru/cv/"]) {
    await assert.rejects(page(route), { code: "ENOENT" }, `${route} should not build`);
  }
});

test("the header offers exactly the three sections", async () => {
  const english = await page("/");
  const russian = await page("/ru/");
  for (const href of ['href="/tools/"', 'href="/articles/"', 'href="/about/"']) {
    assert.match(english, new RegExp(href.replace(/\//g, "\\/")), href);
  }
  for (const href of ['href="/ru/tools/"', 'href="/ru/articles/"', 'href="/ru/about/"']) {
    assert.match(russian, new RegExp(href.replace(/\//g, "\\/")), href);
  }
});

test("homepages stay self-contained apart from the theme script", async () => {
  const english = await page("/");
  const russian = await page("/ru/");
  // The homepage used to carry no script at all. It may now carry exactly one,
  // and only the blocking theme script: anything else is a regression.
  const scripts = [...english.matchAll(/<script\b[^>]*>/gi)];
  assert.equal(scripts.length, 1, "the homepage should carry exactly one script tag");
  assert.match(scripts[0][0], /<script src="\/theme\.js">/);
  assert.doesNotMatch(english, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i, "inline script on the homepage");
  assert.doesNotMatch(english, /rel="stylesheet"/i);
  assert.match(english, /hreflang="ru"/);
  assert.match(russian, /hreflang="en"/);
});

test("the theme toggle ships with the contract theme.js expects", async () => {
  for (const route of ["/", "/ru/", "/tools/", "/articles/printor/"]) {
    const html = await page(route);
    assert.match(html, /<button[^>]*data-theme-toggle/i, route);
    assert.match(html, /data-theme-labels=/, route);
  }
  const script = await readFile(path.join(output, "theme.js"), "utf8");
  assert.match(script, /sazonov-theme/, "theme.js must use the shared storage key");
  assert.match(script, /data-theme/, "theme.js must stamp the shared attribute");

  // lightningcss drops the quotes around attribute values when it minifies.
  const css = await page("/");
  assert.match(css, /:root\[data-theme=["']?light["']?\]/, "light override missing");
  assert.match(css, /:root\[data-theme=["']?dark["']?\]/, "dark override missing");
});

test("the content security policy allows the theme script and nothing more", async () => {
  const html = await page("/");
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /script-src 'none'/);
  assert.match(html, /connect-src 'none'/);

  const headers = await readFile(path.join(output, "_headers"), "utf8");
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /object-src 'none'/);
});

test("the home page lists the latest articles and both tools", async () => {
  for (const [route, articleBase] of [["/", "/articles/"], ["/ru/", "/ru/articles/"]]) {
    const html = await page(route);
    const links = [...html.matchAll(new RegExp(`href="${articleBase}[a-z-]+/"`, "g"))];
    assert.ok(links.length >= 1, `${route} lists no articles`);
    assert.ok(links.length <= 3, `${route} lists more than three articles`);
    assert.match(html, /href="\/printor\/"/, route);
    assert.match(html, /href="\/glyph-art\/"/, route);
  }
});

test("the tools index links every tool to its page and its article", async () => {
  const english = await page("/tools/");
  assert.match(english, /href="\/printor\/"/);
  assert.match(english, /href="\/articles\/printor\/"/);
  assert.match(english, /href="\/glyph-art\/"/);
  assert.match(english, /href="\/articles\/glyph-art\/"/);
  assert.match(english, />live</);

  const russian = await page("/ru/tools/");
  assert.match(russian, /href="\/printor\/"/);
  assert.match(russian, /href="\/ru\/articles\/printor\/"/);
  assert.match(russian, /href="\/glyph-art\/"/);
  assert.match(russian, /href="\/ru\/articles\/glyph-art\/"/);
});

test("both article indexes list their articles and link the translation", async () => {
  const english = await page("/articles/");
  assert.match(english, /href="\/articles\/printor\/"/);
  assert.match(english, /href="\/articles\/glyph-art\/"/);
  // The HTML minifier sorts attributes, so href comes before hreflang.
  assert.match(english, /<link href="[^"]*\/ru\/articles\/" rel="alternate" hreflang="ru">/);
  assert.match(english, /href="\/ru\/articles\/"/, "no visible RU switch");

  const russian = await page("/ru/articles/");
  assert.match(russian, /href="\/ru\/articles\/printor\/"/);
  assert.match(russian, /href="\/ru\/articles\/glyph-art\/"/);
  assert.match(russian, /<link href="[^"]*\/articles\/" rel="alternate" hreflang="en">/);
  assert.match(russian, /href="\/articles\/"/, "no visible EN switch");
});

test("every article page carries its translation and links its tool", async () => {
  for (const [route, tool] of [
    ["/articles/printor/", "/printor/"],
    ["/ru/articles/printor/", "/printor/"],
    ["/articles/glyph-art/", "/glyph-art/"],
    ["/ru/articles/glyph-art/", "/glyph-art/"],
  ]) {
    const html = await page(route);
    assert.match(html, /rel="alternate" hreflang="(en|ru)"/, route);
    assert.match(html, new RegExp(`href="${tool.replace(/\//g, "\\/")}"`), route);
  }
});

test("the printor article documents the pipeline as it is built", async () => {
  for (const route of ["/articles/printor/", "/ru/articles/printor/"]) {
    const html = await page(route);
    for (const stage of [
      "motion blur",
      "soft paper",
      "grain &amp; gain",
      "torn edges",
      "wiggle",
      "displacement",
      "halftone",
      "paper cuts",
      "overlay",
    ]) {
      assert.ok(html.includes(stage), `${route} is missing the ${stage} stage`);
    }
    assert.match(html, /900/, `${route} should state the export frame cap`);
  }
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
  for (const file of ["sitemap.xml", "robots.txt", "404.html", "og.png", "cv.pdf", "_headers", "CNAME", "theme.js"]) {
    const info = await stat(path.join(output, file));
    assert.ok(info.size > 0, file);
  }
});

test("the sitemap covers the new sections", async () => {
  const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
  for (const route of ["/tools/", "/articles/", "/articles/printor/", "/ru/articles/glyph-art/"]) {
    assert.ok(sitemap.includes(`${route}</loc>`), `${route} missing from the sitemap`);
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

test("glyph art is nested under /glyph-art/ with its preset marks", async () => {
  const html = await page("/glyph-art/");
  assert.match(html, /src="\/glyph-art\/assets\//, "glyph art script is not base-aware");
  assert.doesNotMatch(html, /src="\/assets\//, "glyph art emitted root-absolute assets");
  assert.match(html, /connect-src 'none'/, "glyph art lost its CSP");

  await stat(path.join(output, "glyph-art/support/index.html"));

  // The preset marks are the one thing loaded after the bundle. Missing them
  // does not fail a build or a unit test — it fails silently in production,
  // with every preset printing nothing.
  const module = await readFile(
    path.resolve("apps/glyph-art/src/generatedPresets.ts"),
    "utf8",
  );
  const sources = [...module.matchAll(/source: "(presets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(sources.length >= 60, `only ${sources.length} preset marks are declared`);
  for (const source of sources) {
    const info = await stat(path.join(output, "glyph-art", source));
    assert.ok(info.size > 0, source);
  }
});

test("every page links printor at its deployed path", async () => {
  for (const route of ["/", "/about/", "/ru/", "/ru/about/", "/tools/", "/ru/tools/"]) {
    const html = await page(route);
    assert.match(html, /href="\/printor\/"/, route);
  }
});
