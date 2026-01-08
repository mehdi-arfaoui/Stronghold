import { ConfigBanner } from "../components/config/ConfigBanner";
import { SectionCard } from "../components/ui/SectionCard";
import type { ApiConfig } from "../types";

interface ConfigurationPageProps {
  apiConfig: ApiConfig;
  onSave: (config: ApiConfig) => void;
}

export function ConfigurationPage({ apiConfig, onSave }: ConfigurationPageProps) {
  return (
    <section className="workspace-section" aria-labelledby="configuration-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Configuration</p>
          <h2 id="configuration-title">Connexion API</h2>
          <p className="muted">
            Renseignez l'URL et la clé API pour activer les workflows Stronghold.
          </p>
        </div>
      </div>

      <SectionCard
        eyebrow="Configuration"
        title="Connexion API"
        description="Paramétrez l'URL et la clé API pour débloquer les analyses et exports."
      >
        <ConfigBanner config={apiConfig} onSave={onSave} />
      </SectionCard>
    </section>
  );
}
