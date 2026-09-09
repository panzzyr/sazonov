import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * What to call this build, in the footer.
 *
 * The version says what the tool is and the commit says which build of it you
 * have — the second is the one that matters when a service worker has served
 * a stale bundle. A checkout without git still builds; it just says `local`.
 */
function buildId(url: string) {
  const { version } = JSON.parse(readFileSync(new URL("package.json", url), "utf8"));
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: new URL(".", url),
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    return `${version}·${commit}`;
  } catch {
    return `${version}·local`;
  }
}

// printor is published as a sub-path of the portfolio (sazonov.space/printor/).
// PRINTOR_BASE overrides it so the app can also be served from a root domain.
const base = process.env.PRINTOR_BASE ?? "/printor/";

export default defineConfig({
  base,
  define: { __BUILD__: JSON.stringify(buildId(import.meta.url)) },
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 320,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
