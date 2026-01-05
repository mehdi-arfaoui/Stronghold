import type { ReactNode } from "react";

interface InlineHelpProps {
  children: ReactNode;
  className?: string;
}

export function InlineHelp({ children, className }: InlineHelpProps) {
  return <span className={["inline-help", className].filter(Boolean).join(" ")}>{children}</span>;
}
