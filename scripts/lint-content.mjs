import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const contentRoot = path.join(root, "apps/site/src/content");
const problems = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const source = await readFile(file, "utf8");
    if (!source.startsWith("---\n")) problems.push(`${file}: missing front matter`);
    if (!/^lang: (en|ru)$/m.test(source)) problems.push(`${file}: missing valid lang`);
    if (!/^title: .+$/m.test(source)) problems.push(`${file}: missing title`);
    const description = source.match(/^description: ["']?(.+?)["']?$/m)?.[1] ?? "";
    if (description.length > 160) problems.push(`${file}: description exceeds 160 characters`);
  }
}

await visit(contentRoot);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Content checks passed.");
}
