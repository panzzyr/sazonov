import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "lightningcss";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const inputs = [
  path.join(root, "packages/tokens/tokens.css"),
  path.join(root, "apps/site/src/site.css"),
];
const source = (await Promise.all(inputs.map((file) => readFile(file, "utf8")))).join("\n");
const result = transform({
  filename: "site.css",
  code: Buffer.from(source),
  minify: true,
  targets: { safari: 17 << 16, firefox: 130 << 16, chrome: 111 << 16 },
});
const outputDirectory = path.join(root, "apps/site/src/_includes/generated");

await mkdir(outputDirectory, { recursive: true });
await writeFile(path.join(outputDirectory, "styles.css"), result.code);
