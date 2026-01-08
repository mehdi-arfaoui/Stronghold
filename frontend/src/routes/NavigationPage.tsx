import { useMemo, useState } from "react";
import { InfoBadge } from "../components/ui/InfoBadge";
import { SectionCard } from "../components/ui/SectionCard";
import { TabNavigation } from "../components/navigation/TabNavigation";
import { SERVICE_DOMAINS } from "../constants/domains";
import { MODULE_ROUTES } from "../constants/navigation";
import type { TabId } from "../types";

interface NavigationPageProps {
  activeTab: TabId;
  onNavigateTab: (tabId: TabId) => void;
}

export function NavigationPage({ activeTab, onNavigateTab }: NavigationPageProps) {
  const [tabQuery, setTabQuery] = useState("");

  const filteredTabs = useMemo(() => {
    const query = tabQuery.trim().toLowerCase();
    if (!query) return MODULE_ROUTES;
    return MODULE_ROUTES.filter(
      (tab) =>
        tab.label.toLowerCase().includes(query) ||
        tab.description.toLowerCase().includes(query)
    );
  }, [tabQuery]);

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
        eyebrow="Navigation"
        title="Catalogue des modules"
        description="Filtrez les modules disponibles et accédez aux analyses correspondantes."
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
                {filteredTabs.length}/{MODULE_ROUTES.length}
              </span>
            </div>
          </div>
        }
      >
        {filteredTabs.length ? (
          <TabNavigation tabs={filteredTabs} activeTab={activeTab} onChange={onNavigateTab} />
        ) : (
          <p className="empty-state">Aucun module ne correspond à cette recherche.</p>
        )}
      </SectionCard>
    </section>
  );
}
