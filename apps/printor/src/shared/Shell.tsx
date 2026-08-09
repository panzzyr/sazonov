import type { ReactNode } from "react";
import { useTheme, type Theme } from "./theme";

type ToolShellProps = {
  children: ReactNode;
  name: string;
  support?: boolean;
};

// The tool is served under a base path, so internal links have to be built
// from it rather than assuming the origin root.
const base = import.meta.env.BASE_URL;

const themeLabels: Record<Theme, string> = {
  light: "light",
  dark: "dark",
  system: "auto",
};

export function ThemeButton() {
  const { theme, cycle } = useTheme();
  return (
    <button
      type="button"
      className="theme-button"
      onClick={cycle}
      aria-label={`Theme: ${themeLabels[theme]}. Switch.`}
    >
      {themeLabels[theme]}
    </button>
  );
}

export function ToolShell({ children, name, support = false }: ToolShellProps) {
  return (
    <div className="tool-shell">
      <header className="tool-header">
        <a className="tool-owner" href="https://sazonov.space" aria-label="Stepan Sazonov">S</a>
        <a className="tool-name" href={base}>{name}</a>
        <nav aria-label="Tool navigation">
          <a aria-current={support ? "page" : undefined} href={`${base}support/`}>support</a>
          <a href="https://sazonov.space/tools/">all tools ↗</a>
          <ThemeButton />
        </nav>
      </header>
      {children}
      <footer className="tool-footer">
        <a href="https://sazonov.space">sazonov.space ↗</a>
      </footer>
    </div>
  );
}
