interface QuickLink {
  label: string;
  href: string;
  description?: string;
}

interface PageIntroProps {
  title: string;
  objective: string;
  steps: string[];
  links: QuickLink[];
  expectedData: string[];
  tips?: string[];
  progress: {
    value: number;
    label: string;
  };
}

export function PageIntro({
  title,
  objective,
  steps,
  links,
  expectedData,
  tips,
  progress,
}: PageIntroProps) {
  return (
    <div className="card page-intro">
      <div className="page-intro-main">
        <p className="eyebrow">Pourquoi cette page ?</p>
        <h3 className="page-intro-title">{title}</h3>
        <p className="muted">{objective}</p>
        <div className="progress-block">
          <div className="progress-header">
            <span className="pill subtle">Progression {progress.value}%</span>
            <span className="muted small">{progress.label}</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={progress.value}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="progress-value" style={{ width: `${progress.value}%` }} />
          </div>
        </div>
      </div>
      <div className="page-intro-side">
        <div className="page-intro-block">
          <p className="eyebrow">Checklist rapide</p>
          <ul className="checklist">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </div>
        <div className="page-intro-block">
          <p className="eyebrow">Actions rapides</p>
          <div className="quick-links">
            {links.map((link) => (
              <a key={link.label} href={link.href} className="quick-link">
                <span>{link.label}</span>
                {link.description && <span className="muted small">{link.description}</span>}
              </a>
            ))}
          </div>
        </div>
      </div>
      {tips && tips.length > 0 ? (
        <div className="page-intro-tips">
          <p className="eyebrow">Aides contextuelles</p>
          <ul className="tips-list">
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="page-intro-callout">
        <p className="eyebrow">Données attendues</p>
        <ul className="callout-list">
          {expectedData.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
