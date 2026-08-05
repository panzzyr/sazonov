import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./shared/tokens.css";
import "./shared/shell.css";
import "./styles.css";
import { App } from "./App";
import { Support } from "./Support";

const base = import.meta.env.BASE_URL;
const isSupport = window.location.pathname.startsWith(`${base}support`);

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
