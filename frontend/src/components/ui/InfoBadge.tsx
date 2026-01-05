import type { ReactNode } from "react";

type InfoBadgeVariant = "default" | "subtle";

interface InfoBadgeProps {
  children: ReactNode;
  variant?: InfoBadgeVariant;
  className?: string;
}

export function InfoBadge({ children, variant = "default", className }: InfoBadgeProps) {
  return (
    <span
      className={["info-badge", variant === "subtle" ? "subtle" : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
