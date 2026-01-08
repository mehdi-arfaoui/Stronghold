import { Link } from "react-router-dom";
import { NavMenu, type NavGroup } from "./NavMenu";
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
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="header-logo" to="/" aria-label="Stronghold" onClick={onNavigate}>
          <span className="logo-mark" aria-hidden="true">
            SH
          </span>
          <span className="logo-text">Stronghold</span>
        </Link>

        <div className="header-nav-desktop">
          <NavMenu groups={groups} onNavigate={onNavigate} />
        </div>

        <div className="header-actions">
          <button type="button" className="btn subtle" onClick={onQuickAction}>
            Démarrer un PRA
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
            <span>Menu</span>
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
          <span className="mobile-menu-title">Navigation</span>
          <button type="button" className="btn subtle" onClick={onMenuToggle}>
            Fermer
          </button>
        </div>
        <NavMenu groups={groups} onNavigate={onNavigate} variant="vertical" />
        <button type="button" className="btn primary" onClick={onQuickAction}>
          Démarrer un PRA
        </button>
      </aside>
    </header>
  );
}
