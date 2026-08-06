import type { ReactNode } from "react";

type ToolShellProps = {
  children: ReactNode;
  support?: boolean;
};

export function ToolShell({ children, support = false }: ToolShellProps) {
  return (
    <div className="tool-shell">
      <header className="tool-header">
        <a className="tool-owner" href="https://sazonov.space" aria-label="Stepan Sazonov">
          S
        </a>
        <a className="tool-name" href="/">printor</a>
        <nav aria-label="Tool navigation">
          <a aria-current={support ? "page" : undefined} href="/support/">support</a>
          <a href="https://sazonov.space/">all tools ↗</a>
        </nav>
      </header>
      {children}
      <footer className="tool-footer">
        <p>Free. Local. No account.</p>
        <p>Files stay on your device.</p>
        <a href="https://sazonov.space">sazonov.space ↗</a>
      </footer>
    </div>
  );
}

export function PrivacyLine() {
  return (
    <p className="privacy-line">
      Everything is processed on your device. Nothing is uploaded.
    </p>
  );
}
