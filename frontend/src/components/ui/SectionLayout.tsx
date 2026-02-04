import type { ReactNode } from "react";

interface QuickLink {
  label: string;
  href: string;
}

interface SectionLayoutProps {
  /** Identifiant unique pour la section */
  id: string;
  /** Titre principal de la section */
  title: string;
  /** Description courte (1 ligne) */
  description?: string;
  /** Badge affiché à côté du titre (ex: nombre d'éléments) */
  badge?: string;
  /** Progression en pourcentage (0-100) */
  progress?: {
    value: number;
    label: string;
  };
  /** Texte explicatif "Pourquoi cette étape" */
  whyThisStep?: string;
  /** Liens rapides vers les actions principales */
  quickLinks?: QuickLink[];
  /** Conseils contextuels (2-3 maximum) */
  tips?: string[];
  /** Contenu principal de la section */
  children: ReactNode;
}

export function SectionLayout({
  id,
  title,
  description,
  badge,
  progress,
  whyThisStep,
  quickLinks,
  tips,
  children,
}: SectionLayoutProps) {
  const hasSidebar = progress || whyThisStep || quickLinks?.length || tips?.length;

  return (
    <section id={id} className="section-layout" aria-labelledby={`${id}-title`}>
      <div className={`section-layout-body ${hasSidebar ? "has-sidebar" : ""}`}>
        {/* Contenu principal */}
        <div className="section-layout-main">
          <header className="section-layout-header">
            <div className="section-layout-title-group">
              <h2 id={`${id}-title`} className="section-layout-title">
                {title}
              </h2>
              {description && (
                <p className="section-layout-description">{description}</p>
              )}
            </div>
            {badge && <span className="badge subtle">{badge}</span>}
          </header>
          <div className="section-layout-content">{children}</div>
        </div>

        {/* Panneau latéral sticky */}
        {hasSidebar && (
          <aside className="section-layout-sidebar" aria-label="Aide contextuelle">
            {/* Progression */}
            {progress && (
              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Progression</h3>
                <div className="progress-block">
                  <div className="progress-header">
                    <span className="progress-percent">{progress.value}%</span>
                    <span className="progress-label">{progress.label}</span>
                  </div>
                  <div
                    className="progress-track"
                    role="progressbar"
                    aria-valuenow={progress.value}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progression: ${progress.value}%`}
                  >
                    <div
                      className="progress-value"
                      style={{ width: `${progress.value}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Pourquoi cette étape */}
            {whyThisStep && (
              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Pourquoi cette étape ?</h3>
                <p className="sidebar-card-text">{whyThisStep}</p>
              </div>
            )}

            {/* Actions rapides */}
            {quickLinks && quickLinks.length > 0 && (
              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Actions rapides</h3>
                <div className="sidebar-links">
                  {quickLinks.map((link) => (
                    <a key={link.href} href={link.href} className="sidebar-link">
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Conseils */}
            {tips && tips.length > 0 && (
              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Conseils</h3>
                <ul className="sidebar-tips">
                  {tips.map((tip, index) => (
                    <li key={index}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
