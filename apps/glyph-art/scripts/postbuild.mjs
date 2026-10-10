import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const output = path.join(process.cwd(), "dist");
const support = path.join(output, "support");
await mkdir(support, { recursive: true });
await copyFile(path.join(output, "index.html"), path.join(support, "index.html"));
// Sprite sheets are committed regeneration inputs, no longer runtime assets.
// Only remove this generated build copy; leave all source artwork intact.
await rm(path.join(output, "presets"), { recursive: true, force: true });
