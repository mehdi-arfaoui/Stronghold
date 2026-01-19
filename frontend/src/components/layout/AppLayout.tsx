import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import type { NavGroup } from "../navigation/NavMenu";
import type { HomeStep, HomeStepId } from "../home/HomePage";
import { useTranslation } from "react-i18next";
import type { Language } from "../../i18n/languages";
import type { ThemeMode } from "../../utils/preferences";
import { getLanguageOptions } from "../../i18n/utils";
import type { BrandingSettings } from "../../types";
import "./AppLayout.css";

interface AppLayoutProps {
  children: ReactNode;
  groups: NavGroup[];
  steps: HomeStep[];
  activeStepId: HomeStepId;
  completedSteps: HomeStepId[];
  maxAllowedIndex: number;
  onStepAction: (stepId: HomeStepId) => void;
  onQuickAction: () => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onMenuClose: () => void;
  isNavigationLocked?: boolean;
  branding?: BrandingSettings | null;
}

export function AppLayout({
  children,
  groups,
  steps,
  activeStepId,
  completedSteps,
  maxAllowedIndex,
  onStepAction,
  onQuickAction,
  theme,
  onToggleTheme,
  language,
  onLanguageChange,
  isMenuOpen,
  onMenuToggle,
  onMenuClose,
  isNavigationLocked = false,
  branding,
}: AppLayoutProps) {
  const { t } = useTranslation();
  const languageOptions = getLanguageOptions(t);
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
              <span className="sr-only">{t("navigation")}</span>
            </button>
            <Link className="header-logo" to="/" aria-label={t("appName")}>
              <span className="logo-mark" aria-hidden="true">
                SH
              </span>
              {branding?.logoUrl ? (
                <img className="logo-image" src={branding.logoUrl} alt={t("appName")} />
              ) : (
                <span className="logo-text">{t("appName")}</span>
              )}
            </Link>
          </div>

          <div className="header-actions">
            <button
              type="button"
              className="btn subtle"
              onClick={onQuickAction}
              disabled={isNavigationLocked}
              aria-disabled={isNavigationLocked}
            >
              {t("quickAction")}
            </button>
            <div className="header-control">
              <label className="sr-only" htmlFor="language-switch">
                {t("languageLabel")}
              </label>
              <select
                id="language-switch"
                value={language}
                onChange={(event) => onLanguageChange(event.target.value as Language)}
                aria-label={t("languageLabel")}
              >
                {languageOptions.map((option) => (
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
              aria-label={t("themeLabel")}
            >
              {theme === "dark" ? t("darkMode") : t("lightMode")}
            </button>
          </div>
        </div>
      </header>

      <div className={`app-body ${isMenuOpen ? "sidebar-open" : "sidebar-closed"}`}>
        <Sidebar
          groups={groups}
          steps={steps}
          activeStepId={activeStepId}
          completedSteps={completedSteps}
          maxAllowedIndex={maxAllowedIndex}
          onStepAction={onStepAction}
          isOpen={isMenuOpen}
          onClose={onMenuClose}
          isNavigationLocked={isNavigationLocked}
        />
        <main id="main-content" className="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
