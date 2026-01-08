import type { KeyboardEvent } from "react";
import type { TabDefinition, TabId } from "../../types";

interface TabNavigationProps {
  tabs: TabDefinition[];
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

export function TabNavigation({ tabs, activeTab, onChange }: TabNavigationProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex === -1) return;

    if (event.key === "ArrowRight") {
      const nextIndex = (currentIndex + 1) % tabs.length;
      onChange(tabs[nextIndex].id);
    }

    if (event.key === "ArrowLeft") {
      const nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      onChange(tabs[nextIndex].id);
    }
  };

  return (
    <div
      className="tab-list"
      role="tablist"
      aria-label="Navigation principale"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            className={`tab ${isActive ? "active" : ""}`}
            role="tab"
            aria-selected={isActive}
            aria-controls={`${tab.id}-panel`}
            id={`${tab.id}-tab`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
          >
            <span className="tab-label">{tab.label}</span>
            <span className="tab-description">{tab.description}</span>
          </button>
        );
      })}
    </div>
  );
}
