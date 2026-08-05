import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "dist");
const support = path.join(output, "support");
await mkdir(support, { recursive: true });
await copyFile(path.join(output, "index.html"), path.join(support, "index.html"));
