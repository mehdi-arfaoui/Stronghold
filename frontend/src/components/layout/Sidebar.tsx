import { NavMenu } from "../navigation/NavMenu";
import { WizardProgress } from "../wizard/WizardProgress";
import type { NavGroup } from "../navigation/NavMenu";
import type { HomeStep, HomeStepId } from "../home/HomePage";
import type { TranslationCopy } from "../../i18n/translations";

interface SidebarProps {
  groups: NavGroup[];
  copy: TranslationCopy;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({
  groups,
  copy,
  steps,
  activeStepId,
  completedSteps,
  onStepAction,
  isOpen,
  onClose,
}: SidebarProps) {
  return (
    <>
      <div className={`sidebar-backdrop ${isOpen ? "open" : ""}`} role="presentation" onClick={onClose} />
      <aside
        id="app-sidebar"
        className={`app-sidebar ${isOpen ? "open" : ""}`}
        aria-label={copy.sidebarTitle}
      >
        <div className="sidebar-header">
          <p className="sidebar-title">{copy.navigation}</p>
          <button type="button" className="btn subtle" onClick={onClose}>
            {copy.closeLabel}
          </button>
        </div>
        <NavMenu
          groups={groups}
          onNavigate={onClose}
          variant="vertical"
          ariaLabel={copy.sidebarTitle}
        />
        <WizardProgress
          copy={copy}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
        />
      </aside>
    </>
  );
}
