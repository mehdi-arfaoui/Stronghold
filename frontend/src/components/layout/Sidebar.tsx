import { NavMenu } from "../navigation/NavMenu";
import { WizardProgress } from "../wizard/WizardProgress";
import type { NavGroup } from "../navigation/NavMenu";
import type { HomeStep, HomeStepId } from "../home/HomePage";
import { useTranslation } from "react-i18next";

interface SidebarProps {
  groups: NavGroup[];
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
  isOpen: boolean;
  onClose: () => void;
  isNavigationLocked?: boolean;
}

export function Sidebar({
  groups,
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
  isOpen,
  onClose,
  isNavigationLocked = false,
}: SidebarProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className={`sidebar-backdrop ${isOpen ? "open" : ""}`} role="presentation" onClick={onClose} />
      <aside
        id="app-sidebar"
        className={`app-sidebar ${isOpen ? "open" : ""}`}
        aria-label={t("sidebarTitle")}
      >
        <div className="sidebar-header">
          <p className="sidebar-title">{t("navigation")}</p>
          <button type="button" className="btn subtle" onClick={onClose}>
            {t("closeLabel")}
          </button>
        </div>
        <NavMenu
          groups={groups}
          onNavigate={onClose}
          variant="vertical"
          ariaLabel={t("sidebarTitle")}
          disabled={isNavigationLocked}
        />
        <WizardProgress
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          maxAllowedIndex={maxAllowedIndex}
          onStepAction={onStepAction}
        />
      </aside>
    </>
  );
}
