import { Link } from "react-router-dom";
import { NavMenu, type NavGroup } from "./NavMenu";
import { useTranslation } from "react-i18next";
import "./Header.css";

interface HeaderProps {
  groups: NavGroup[];
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  onNavigate: () => void;
  onQuickAction: () => void;
}

export function Header({
  groups,
  isMenuOpen,
  onMenuToggle,
  onNavigate,
  onQuickAction,
}: HeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="header-logo" to="/" aria-label={t("appName")} onClick={onNavigate}>
          <span className="logo-mark" aria-hidden="true">
            SH
          </span>
          <span className="logo-text">{t("appName")}</span>
        </Link>

        <div className="header-nav-desktop">
          <NavMenu groups={groups} onNavigate={onNavigate} />
        </div>

        <div className="header-actions">
          <button type="button" className="btn subtle" onClick={onQuickAction}>
            {t("quickAction")}
          </button>
          <button
            type="button"
            className="menu-toggle"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-menu"
            onClick={onMenuToggle}
          >
            <span className="menu-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{t("menuLabel")}</span>
          </button>
        </div>
      </div>

      <div
        className={`mobile-backdrop ${isMenuOpen ? "open" : ""}`}
        role="presentation"
        onClick={onMenuToggle}
      />

      <aside
        id="mobile-menu"
        className={`mobile-menu ${isMenuOpen ? "open" : ""}`}
        aria-hidden={!isMenuOpen}
      >
        <div className="mobile-menu-header">
          <span className="mobile-menu-title">{t("navigation")}</span>
          <button type="button" className="btn subtle" onClick={onMenuToggle}>
            {t("closeLabel")}
          </button>
        </div>
        <NavMenu groups={groups} onNavigate={onNavigate} variant="vertical" />
        <button type="button" className="btn primary" onClick={onQuickAction}>
          {t("quickAction")}
        </button>
      </aside>
    </header>
  );
}
