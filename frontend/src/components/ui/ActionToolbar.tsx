import type { HTMLAttributes, ReactNode } from "react";

interface ActionToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ActionToolbar({ children, className, ...rest }: ActionToolbarProps) {
  return (
    <div className={["action-toolbar", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}
