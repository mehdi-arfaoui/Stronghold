import { useState, type ReactNode } from "react";

interface HelpButtonProps {
  title?: string;
  buttonLabel?: string;
  className?: string;
  children: ReactNode;
}

export function HelpButton({
  title = "Aide contextuelle",
  buttonLabel = "Aide ?",
  className,
  children,
}: HelpButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={["help-box", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="btn subtle help-box-toggle"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? "Masquer l'aide" : buttonLabel}
      </button>
      {isOpen && (
        <div className="help-box-content">
          <p className="eyebrow">{title}</p>
          {children}
        </div>
      )}
    </div>
  );
}
