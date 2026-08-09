import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./shared/tokens.css";
import "./shared/shell.css";
import "./styles.css";
import { App } from "./App";
import { Support } from "./Support";
import { applyTheme, readTheme } from "./shared/theme";

const base = import.meta.env.BASE_URL;
const isSupport = window.location.pathname.startsWith(`${base}support`);

// The site stores the choice under the same key; applying it before the first
// render keeps the tool from flashing the wrong palette on the way in.
applyTheme(readTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isSupport ? <Support /> : <App />}
  </StrictMode>,
);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
  });
}
