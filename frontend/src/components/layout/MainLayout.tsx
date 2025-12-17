import type { ReactNode } from "react";

interface MainLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function MainLayout({ title, description, children }: MainLayoutProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Stronghold</p>
          <h1>{title}</h1>
          <p className="muted">{description}</p>
        </div>
        <div className="badge">PRA/PCA</div>
      </header>

      <main className="app-content">{children}</main>
    </div>
  );
}
