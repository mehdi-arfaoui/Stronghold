import { useMemo, useState } from "react";
import { InfoBadge } from "../components/ui/InfoBadge";
import { SectionCard } from "../components/ui/SectionCard";
import { TabNavigation } from "../components/navigation/TabNavigation";
import type { ModuleGroup } from "../constants/navigation";
import type { TranslationCopy } from "../i18n/translations";
import type { TabId } from "../types";

interface NavigationPageProps {
  activeTab: TabId;
  onNavigateTab: (tabId: TabId) => void;
  copy: TranslationCopy;
  wizardGroup: ModuleGroup;
}

export function NavigationPage({
  activeTab,
  onNavigateTab,
  copy,
  wizardGroup,
}: NavigationPageProps) {
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
          <p className="eyebrow">{copy.navigationEyebrow}</p>
          <h2 id="navigation-title">{copy.navigationTitle}</h2>
          <p className="muted">{copy.navigationSubtitle}</p>
        </div>
      </div>

      <SectionCard
        eyebrow={copy.guidedJourney}
        title={copy.navigationWizardTitle}
        description={copy.navigationWizardDescription}
        actions={
          <div className="tab-controls">
            <InfoBadge variant="subtle">
              {filteredTabCount} {copy.navigationDomainLabel}
            </InfoBadge>
            <div className="tab-search">
              <label className="sr-only" htmlFor="tab-search">
                {copy.navigationSearchLabel}
              </label>
              <input
                id="tab-search"
                type="search"
                value={tabQuery}
                onChange={(event) => setTabQuery(event.target.value)}
                placeholder={copy.navigationSearchPlaceholder}
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
          <p className="empty-state">{copy.navigationEmptyState}</p>
        )}
      </SectionCard>
    </section>
  );
}
