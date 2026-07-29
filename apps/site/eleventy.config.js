import { minify } from "html-minifier-terser";
import markdownIt from "markdown-it";
import temml from "temml";

function mathPlugin(md) {
  md.inline.ruler.after("escape", "math_inline", (state, silent) => {
    if (state.src[state.pos] !== "$" || state.src[state.pos + 1] === "$") return false;
    const end = state.src.indexOf("$", state.pos + 1);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push("math_inline", "math", 0);
      token.content = state.src.slice(state.pos + 1, end);
    }
    state.pos = end + 1;
    return true;
  });
  md.inline.ruler.after("math_inline", "math_block_inline", (state, silent) => {
    if (!state.src.startsWith("$$", state.pos)) return false;
    const end = state.src.indexOf("$$", state.pos + 2);
    if (end < 0) return false;
    if (!silent) {
      const token = state.push("math_block_inline", "math", 0);
      token.content = state.src.slice(state.pos + 2, end);
    }
    state.pos = end + 2;
    return true;
  });
  md.renderer.rules.math_inline = (tokens, index) =>
    temml.renderToString(tokens[index].content, { throwOnError: false });
  md.renderer.rules.math_block_inline = (tokens, index) =>
    temml.renderToString(tokens[index].content, { displayMode: true, throwOnError: false });
}

export default function (eleventyConfig) {
  const markdown = markdownIt({ html: true, linkify: true, typographer: true })
    .use(mathPlugin);
  eleventyConfig.setLibrary("md", markdown);

  eleventyConfig.addPassthroughCopy({ "src/public": "/" });
  eleventyConfig.addWatchTarget("../../packages/tokens/tokens.css");
  eleventyConfig.addWatchTarget("src/site.css");

  eleventyConfig.addPreprocessor("drafts", "*", (data) => {
    if (data.draft && process.env.BUILD_DRAFTS !== "1") return false;
  });

  eleventyConfig.addCollection("posts", (api) =>
    api.getFilteredByGlob("./src/content/**/posts/*.md")
      .filter((item) => process.env.BUILD_DRAFTS === "1" || !item.data.draft)
      .sort((a, b) => b.date - a.date));
  eleventyConfig.addCollection("projects", (api) =>
    api.getFilteredByGlob("./src/content/**/projects/*.md")
      .sort((a, b) => Number(b.data.sortYear) - Number(a.data.sortYear)));

  eleventyConfig.addFilter("isoDate", (date) => {
    const value = date instanceof Date ? date : new Date(date);
    return value.toISOString().slice(0, 10);
  });
  eleventyConfig.addFilter("readingTime", (content = "") => {
    const words = content.replace(/<[^>]+>/g, " ").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.ceil(words / 220));
  });
  eleventyConfig.addFilter("whereLang", (items = [], lang) =>
    items.filter((item) => item.data.lang === lang));
  eleventyConfig.addFilter("limit", (items = [], count) => items.slice(0, count));
  eleventyConfig.addFilter("absoluteUrl", (url, base) => new URL(url, base).href);

  eleventyConfig.addTransform("minify-html", async function (content) {
    if (!this.page.outputPath?.endsWith(".html")) return content;
    return minify(content, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      removeRedundantAttributes: true,
      sortAttributes: true,
      sortClassName: true,
      useShortDoctype: true,
    });
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "_includes",
      data: "_data",
    },
    markdownTemplateEngine: "njk",
    htmlTemplateEngine: "njk",
    templateFormats: ["md", "njk", "html"],
  };
}
