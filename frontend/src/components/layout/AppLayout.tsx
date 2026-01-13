import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import type { NavGroup } from "../navigation/NavMenu";
import type { HomeStep, HomeStepId } from "../home/HomePage";
import type { Language, TranslationCopy } from "../../i18n/translations";
import type { ThemeMode } from "../../utils/preferences";
import { LANGUAGE_OPTIONS } from "../../i18n/utils";
import "./AppLayout.css";

interface AppLayoutProps {
  children: ReactNode;
  groups: NavGroup[];
  copy: TranslationCopy;
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  onStepAction: (stepId: HomeStepId) => void;
  onQuickAction: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
}

export function AppLayout({
  children,
  groups,
  copy,
  steps,
  activeStepId,
  completedSteps,
  onStepAction,
  onQuickAction,
  theme,
  onToggleTheme,
  language,
  onLanguageChange,
  isMenuOpen,
  onMenuToggle,
  onMenuClose,
}: AppLayoutProps) {
  return (
    <div className="app-layout">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="header-brand">
            <button
              type="button"
              className="menu-toggle"
              aria-expanded={isMenuOpen}
              aria-controls="app-sidebar"
              onClick={onMenuToggle}
            >
              <span className="menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className="sr-only">{copy.navigation}</span>
            </button>
            <Link className="header-logo" to="/" aria-label={copy.appName}>
              <span className="logo-mark" aria-hidden="true">
                SH
              </span>
              <span className="logo-text">{copy.appName}</span>
            </Link>
          </div>

          <div className="header-actions">
            <button type="button" className="btn subtle" onClick={onQuickAction}>
              {copy.quickAction}
            </button>
            <div className="header-control">
              <label className="sr-only" htmlFor="language-switch">
                {copy.languageLabel}
              </label>
              <select
                id="language-switch"
                value={language}
                onChange={(event) => onLanguageChange(event.target.value as Language)}
                aria-label={copy.languageLabel}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn subtle"
              onClick={onToggleTheme}
              aria-pressed={theme === "dark"}
              aria-label={copy.themeLabel}
            >
              {theme === "dark" ? copy.darkMode : copy.lightMode}
            </button>
          </div>
        </div>
      </header>

      <div className={`app-body ${isMenuOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <Sidebar
          groups={groups}
          copy={copy}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          onStepAction={onStepAction}
          isOpen={isMenuOpen}
          onClose={onMenuClose}
        />
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
