import type { ReactNode } from "react";
import "./ProgressOverlay.css";

export type ScanStep = {
  id: string;
  label: string;
  description?: string;
};

interface ProgressOverlayProps {
  isOpen: boolean;
  progress: number;
  currentStep?: string | null;
  steps: ScanStep[];
  summary?: ReactNode;
  errorMessage?: string | null;
}

export function ProgressOverlay({
  isOpen,
  progress,
  currentStep,
  steps,
  summary,
  errorMessage,
}: ProgressOverlayProps) {
  if (!isOpen) return null;

  const activeIndex = steps.findIndex((step) => step.id === currentStep);

  return (
    <div className="progress-overlay" role="status" aria-live="polite">
      <div className="progress-overlay-card">
        <div className="progress-overlay-header">
          <h3>Scan initial en cours</h3>
          <p className="muted">
            Le scan est en cours d’exécution. Vous pouvez laisser cette page ouverte pendant la
            découverte.
          </p>
        </div>
        <div className="progress-overlay-bar">
          <div className="progress-overlay-bar-track">
            <span style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
          </div>
          <span className="progress-overlay-bar-label">{progress}%</span>
        </div>
        <ol className="progress-overlay-steps">
          {steps.map((step, index) => {
            const status =
              activeIndex === -1
                ? "pending"
                : index < activeIndex
                ? "done"
                : index === activeIndex
                ? "active"
                : "pending";
            return (
              <li key={step.id} className={`progress-step ${status}`}>
                <div>
                  <span className="progress-step-label">{step.label}</span>
                  {step.description && <span className="muted small">{step.description}</span>}
                </div>
                <span className="progress-step-status">
                  {status === "done" ? "✓" : status === "active" ? "…" : "•"}
                </span>
              </li>
            );
          })}
        </ol>
        {summary && <div className="progress-overlay-summary">{summary}</div>}
        {errorMessage && (
          <div className="progress-overlay-error">
            <strong>Erreur :</strong> {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
