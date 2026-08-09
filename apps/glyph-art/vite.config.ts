import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// glyph art is published as a sub-path of the portfolio (sazonov.space/glyph-art/).
// GLYPH_ART_BASE overrides it so the app can also be served from a root domain.
const base = process.env.GLYPH_ART_BASE ?? "/glyph-art/";

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 320,
  },
  server: {
    host: "127.0.0.1",
    port: 5174,
  },
});
