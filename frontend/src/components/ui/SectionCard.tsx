import type { ReactNode } from "react";

interface SectionCardProps {
  eyebrow?: string;
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function SectionCard({
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
}: SectionCardProps) {
  return (
    <section className={["panel", "section-card", className].filter(Boolean).join(" ")}>
      {(eyebrow || title || description || actions) && (
        <div className="section-card-header">
          <div className="section-card-title">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
            {description && <p className="muted">{description}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
