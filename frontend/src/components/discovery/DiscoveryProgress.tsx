import type { DiscoveryJob } from "../../types";

type ProgressStep = {
  id: string;
  label: string;
  description: string;
};

interface DiscoveryProgressProps {
  job: DiscoveryJob | null;
  steps: ProgressStep[];
  resourceCount: number;
  statusNote?: string | null;
}

function getStepIndex(steps: ProgressStep[], currentStep?: string | null) {
  if (!currentStep) return 0;
  const index = steps.findIndex((step) => step.id === currentStep);
  return index >= 0 ? index : 0;
}

export function DiscoveryProgress({
  job,
  steps,
  resourceCount,
  statusNote,
}: DiscoveryProgressProps) {
  const progressValue = job?.progress ?? 0;
  const statusLabel = job ? `${job.status} · ${progressValue}%` : "En attente";
  const activeIndex = getStepIndex(steps, job?.step ?? null);

  return (
    <div className="card discovery-progress">
      <div className="progress-header">
        <div>
          <p className="eyebrow">Progression</p>
          <h3>Suivi de la découverte</h3>
          <p className="muted small">{statusLabel}</p>
        </div>
        <div className="progress-meta">
          {statusNote && <div className="badge subtle">{statusNote}</div>}
          <div className="badge subtle">{resourceCount} ressources</div>
        </div>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuenow={progressValue}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-value" style={{ width: `${progressValue}%` }} />
      </div>
      <ol className="progress-timeline">
        {steps.map((step, index) => {
          const isActive = index === activeIndex;
          const isDone = job ? index < activeIndex : false;
          return (
            <li key={step.id} className={isActive ? "active" : isDone ? "done" : undefined}>
              <div className="timeline-dot" aria-hidden="true" />
              <div>
                <span className="timeline-title">{step.label}</span>
                <span className="muted small">{step.description}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
