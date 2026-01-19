import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfoBadge } from "../components/ui/InfoBadge";
import { SectionCard } from "../components/ui/SectionCard";
import { TabNavigation } from "../components/navigation/TabNavigation";
import type { ModuleGroup } from "../constants/navigation";
import type { TabId } from "../types";

interface NavigationPageProps {
  activeTab: TabId;
  onNavigateTab: (tabId: TabId) => void;
  wizardGroup: ModuleGroup;
}

export function NavigationPage({
  activeTab,
  onNavigateTab,
  wizardGroup,
}: NavigationPageProps) {
  const { t } = useTranslation();
  const [tabQuery, setTabQuery] = useState("");

  const filteredWizardTabs = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return wizardGroup.tabs;
    return wizardGroup.tabs.filter(
      (tab) =>
        tab.label.toLowerCase().includes(query) ||
        tab.description.toLowerCase().includes(query)
    );
  }, [tabQuery, wizardGroup.tabs]);

  const filteredTabCount = filteredWizardTabs.length;

  return (
    <section className="workspace-section" aria-labelledby="navigation-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t("navigationEyebrow")}</p>
          <h2 id="navigation-title">{t("navigationTitle")}</h2>
          <p className="muted">{t("navigationSubtitle")}</p>
        </div>
      </div>

      <SectionCard
        eyebrow={t("guidedJourney")}
        title={t("navigationWizardTitle")}
        description={t("navigationWizardDescription")}
        actions={
          <div className="tab-controls">
            <InfoBadge variant="subtle">
              {filteredTabCount} {t("navigationDomainLabel")}
            </InfoBadge>
            <div className="tab-search">
              <label className="sr-only" htmlFor="tab-search">
                {t("navigationSearchLabel")}
              </label>
              <input
                id="tab-search"
                type="search"
                value={tabQuery}
                onChange={(event) => setTabQuery(event.target.value)}
                placeholder={t("navigationSearchPlaceholder")}
              />
              <span className="muted small">
                {filteredTabCount}/{wizardGroup.tabs.length}
              </span>
            </div>
          </div>
        }
      >
        {filteredWizardTabs.length ? (
          <TabNavigation
            tabs={filteredWizardTabs}
            activeTab={activeTab}
            onChange={onNavigateTab}
            showIndex
          />
        ) : (
          <p className="empty-state">{t("navigationEmptyState")}</p>
        )}
      </SectionCard>
    </section>
  );
}
