import { ConfigBanner } from "../components/config/ConfigBanner";
import { SectionCard } from "../components/ui/SectionCard";
import type { ApiConfig } from "../types";
import { useTranslation } from "react-i18next";

interface ConfigurationPageProps {
  apiConfig: ApiConfig;
  onSave: (config: ApiConfig) => void;
}

export function ConfigurationPage({ apiConfig, onSave }: ConfigurationPageProps) {
  const { t } = useTranslation();
  return (
    <section className="workspace-section" aria-labelledby="configuration-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("configurationTitle")}</p>
          <h2 id="configuration-title">{t("configurationSubtitle")}</h2>
          <p className="muted">{t("configurationBody")}</p>
        </div>
      </div>

      <SectionCard
        eyebrow={t("configurationTitle")}
        title={t("configurationCardTitle")}
        description={t("configurationCardDescription")}
      >
        <ConfigBanner config={apiConfig} onSave={onSave} />
      </SectionCard>
    </section>
  );
}
