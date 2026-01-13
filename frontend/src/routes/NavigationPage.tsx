import { useMemo, useState } from "react";
import { InfoBadge } from "../components/ui/InfoBadge";
import { SectionCard } from "../components/ui/SectionCard";
import { TabNavigation } from "../components/navigation/TabNavigation";
import { SERVICE_DOMAINS } from "../constants/domains";
import type { ModuleGroup, ModuleRoute } from "../constants/navigation";
import type { TranslationCopy } from "../i18n/translations";
import type { TabId } from "../types";

interface NavigationPageProps {
  activeTab: TabId;
  onNavigateTab: (tabId: TabId) => void;
  copy: TranslationCopy;
  wizardGroup: ModuleGroup;
  moduleGroups: ModuleGroup[];
  moduleRoutes: ModuleRoute[];
}

export function NavigationPage({
  activeTab,
  onNavigateTab,
  copy,
  wizardGroup,
  moduleGroups,
  moduleRoutes,
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

  const filteredGroups = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return moduleGroups;

    return moduleGroups.map((group) => {
      const groupMatches =
        group.label.toLowerCase().includes(query) ||
        group.description.toLowerCase().includes(query);
      const tabs = group.tabs.filter(
        (tab) =>
          tab.label.toLowerCase().includes(query) ||
          tab.description.toLowerCase().includes(query)
      );
      return {
        ...group,
        tabs: groupMatches && tabs.length === 0 ? group.tabs : tabs,
      };
    }).filter((group) => group.tabs.length > 0);
  }, [moduleGroups, tabQuery]);

  const filteredTabCount = useMemo(
    () => filteredGroups.reduce((total, group) => total + group.tabs.length, 0),
    [filteredGroups]
  );

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
              {SERVICE_DOMAINS.length} {copy.navigationDomainLabel}
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
                {filteredTabCount}/{moduleRoutes.length}
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

      <SectionCard
        eyebrow={copy.navigation}
        title={copy.navigationCatalogTitle}
        description={copy.navigationCatalogDescription}
      >
        {filteredGroups.length ? (
          <div className="nav-group-grid">
            {filteredGroups.map((group) => (
              <div key={group.id} className="nav-group-card">
                <div className="nav-group-header">
                  <p className="nav-group-title">{group.label}</p>
                  <p className="muted small">{group.description}</p>
                  <span className="muted small">
                    {group.tabs.length} module{group.tabs.length > 1 ? "s" : ""}
                  </span>
                </div>
                <TabNavigation tabs={group.tabs} activeTab={activeTab} onChange={onNavigateTab} />
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">{copy.navigationGroupEmptyState}</p>
        )}
      </SectionCard>
    </section>
  );
}
