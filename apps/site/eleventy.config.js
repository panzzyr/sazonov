import { minify } from "html-minifier-terser";

export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ "src/public": "/" });
  eleventyConfig.addWatchTarget("../../packages/tokens/tokens.css");
  eleventyConfig.addWatchTarget("src/site.css");

  eleventyConfig.addPreprocessor("drafts", "*", (data) => {
    if (data.draft && process.env.BUILD_DRAFTS !== "1") return false;
  });

  eleventyConfig.addFilter("isoDate", (date) => {
    const value = date instanceof Date ? date : new Date(date);
    return value.toISOString().slice(0, 10);
  });
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
