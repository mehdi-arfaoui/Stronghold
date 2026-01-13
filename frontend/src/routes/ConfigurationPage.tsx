import { ConfigBanner } from "../components/config/ConfigBanner";
import { SectionCard } from "../components/ui/SectionCard";
import type { TranslationCopy } from "../i18n/translations";
import type { ApiConfig } from "../types";

interface ConfigurationPageProps {
  apiConfig: ApiConfig;
  onSave: (config: ApiConfig) => void;
  copy: TranslationCopy;
}

export function ConfigurationPage({ apiConfig, onSave, copy }: ConfigurationPageProps) {
  return (
    <section className="workspace-section" aria-labelledby="configuration-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{copy.configurationTitle}</p>
          <h2 id="configuration-title">{copy.configurationSubtitle}</h2>
          <p className="muted">{copy.configurationBody}</p>
        </div>
      </div>

      <SectionCard
        eyebrow={copy.configurationTitle}
        title={copy.configurationCardTitle}
        description={copy.configurationCardDescription}
      >
        <ConfigBanner config={apiConfig} onSave={onSave} />
      </SectionCard>
    </section>
  );
}
