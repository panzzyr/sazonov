import type { ReactNode } from "react";

type ToolShellProps = {
  children: ReactNode;
  support?: boolean;
};

// printor is served under a base path, so internal links have to be built from
// it rather than assuming the origin root.
const base = import.meta.env.BASE_URL;

export function ToolShell({ children, support = false }: ToolShellProps) {
  return (
    <div className="tool-shell">
      <header className="tool-header">
        <a className="tool-owner" href="https://sazonov.space" aria-label="Stepan Sazonov">S</a>
        <a className="tool-name" href={base}>printor</a>
        <nav aria-label="Tool navigation">
          <a aria-current={support ? "page" : undefined} href={`${base}support/`}>support</a>
          <a href="https://sazonov.space/tools/">all tools ↗</a>
        </nav>
      </header>
      {children}
      <footer className="tool-footer">
        <a href="https://sazonov.space">sazonov.space ↗</a>
      </footer>
    </div>
  );
}
