import { useState } from "react";
import "./Header.css";

const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Services", href: "#services" },
  { label: "Documents", href: "#documents" },
  { label: "PRA", href: "#pra" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFrench, setIsFrench] = useState(true);

  const toggleMenu = () => setMenuOpen((open) => !open);
  const closeMenu = () => setMenuOpen(false);

  const toggleLanguage = () => setIsFrench((value) => !value);

  return (
    <header className="site-header">
      <div className="header-inner">
        <a className="header-logo" href="#home" aria-label="Stronghold">
          <span className="logo-mark">SH</span>
          <span className="logo-text">Stronghold</span>
        </a>

        <nav className="header-nav" aria-label="Navigation principale">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="header-actions">
          <button type="button" className="icon-button" aria-label="Rechercher">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15.5 15.5L20 20M10.5 18C6.35786 18 3 14.6421 3 10.5C3 6.35786 6.35786 3 10.5 3C14.6421 3 18 6.35786 18 10.5C18 14.6421 14.6421 18 10.5 18Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <button
            type="button"
            className="language-toggle"
            aria-label="Changer la langue"
            aria-pressed={isFrench}
            onClick={toggleLanguage}
          >
            <span className={isFrench ? "active" : ""}>FR</span>
            <span className={!isFrench ? "active" : ""}>EN</span>
          </button>

          <button type="button" className="cta-button">
            Accéder à l&apos;outil
          </button>

          <button
            type="button"
            className="menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={toggleMenu}
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
        className={`sidebar-backdrop ${menuOpen ? "open" : ""}`}
        role="presentation"
        onClick={closeMenu}
      />

      <aside
        id="mobile-menu"
        className={`sidebar ${menuOpen ? "open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <div className="sidebar-header">
          <span className="sidebar-title">Navigation</span>
          <button type="button" className="sidebar-close" onClick={closeMenu}>
            Fermer
          </button>
        </div>
        <nav aria-label="Navigation mobile">
          <ul>
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <a href={link.href} onClick={closeMenu}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <button type="button" className="cta-button full-width">
          Accéder à l&apos;outil
        </button>
      </aside>
    </header>
  );
}
