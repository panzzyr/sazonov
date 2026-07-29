import { readFile } from "node:fs/promises";
import { optimize } from "svgo";

export default async function () {
  try {
    const source = await readFile(new URL("../logo.svg", import.meta.url), "utf8");
    const result = optimize(source, {
      multipass: true,
      plugins: ["preset-default", "removeDimensions"],
    });
    return {
      logo: result.data
        .replaceAll('fill="#fff"', 'fill="currentColor"')
        .replaceAll('fill="white"', 'fill="currentColor"'),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { logo: "" };
  }
}
