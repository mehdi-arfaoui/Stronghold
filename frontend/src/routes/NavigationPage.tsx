import { useMemo, useState } from "react";
import { InfoBadge } from "../components/ui/InfoBadge";
import { SectionCard } from "../components/ui/SectionCard";
import { TabNavigation } from "../components/navigation/TabNavigation";
import { SERVICE_DOMAINS } from "../constants/domains";
import { MODULE_GROUPS, MODULE_ROUTES, WIZARD_STEP_GROUP } from "../constants/navigation";
import type { TabId } from "../types";

interface NavigationPageProps {
  activeTab: TabId;
  onNavigateTab: (tabId: TabId) => void;
}

export function NavigationPage({ activeTab, onNavigateTab }: NavigationPageProps) {
  const [tabQuery, setTabQuery] = useState("");

  const filteredWizardTabs = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return WIZARD_STEP_GROUP.tabs;
    return WIZARD_STEP_GROUP.tabs.filter(
      (tab) =>
        tab.label.toLowerCase().includes(query) ||
        tab.description.toLowerCase().includes(query)
    );
  }, [tabQuery]);

  const filteredGroups = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return MODULE_GROUPS;

    return MODULE_GROUPS.map((group) => {
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
  }, [tabQuery]);

  const filteredTabCount = useMemo(
    () => filteredGroups.reduce((total, group) => total + group.tabs.length, 0),
    [filteredGroups]
  );

  return (
    <section className="workspace-section" aria-labelledby="navigation-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Navigation</p>
          <h2 id="navigation-title">Vue d'ensemble</h2>
          <p className="muted">
            Accédez rapidement à chaque module pour orchestrer la continuité.
          </p>
        </div>
      </div>

      <SectionCard
        eyebrow="Parcours guidé"
        title="Avancez étape par étape"
        description="Suivez le flux recommandé pour générer votre PRA complet."
        actions={
          <div className="tab-controls">
            <InfoBadge variant="subtle">{SERVICE_DOMAINS.length} domaines suivis</InfoBadge>
            <div className="tab-search">
              <label className="sr-only" htmlFor="tab-search">
                Rechercher un module
              </label>
              <input
                id="tab-search"
                type="search"
                value={tabQuery}
                onChange={(event) => setTabQuery(event.target.value)}
                placeholder="Rechercher un module"
              />
              <span className="muted small">
                {filteredTabCount}/{MODULE_ROUTES.length}
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
          <p className="empty-state">Aucun module ne correspond à cette recherche.</p>
        )}
      </SectionCard>

      <SectionCard
        eyebrow="Navigation"
        title="Catalogue regroupé"
        description="Explorez les modules par grands ensembles fonctionnels."
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
          <p className="empty-state">Aucun groupe ne correspond à cette recherche.</p>
        )}
      </SectionCard>
    </section>
  );
}
