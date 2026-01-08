import { NavLink as RouterNavLink } from "react-router-dom";
import type { NavLink } from "../navigation/NavMenu";

interface FooterProps {
  links: NavLink[];
}

export function Footer({ links }: FooterProps) {
  return (
    <footer className="site-footer" aria-labelledby="footer-title">
      <div className="footer-inner">
        <div>
          <p id="footer-title" className="footer-title">
            Stronghold PRA/PCA
          </p>
          <p className="muted">
            Plateforme de résilience et d'analyse continue pour les organisations critiques.
          </p>
        </div>
        <nav className="footer-nav" aria-label="Navigation secondaire">
          <ul>
            {links.map((link) => (
              <li key={link.id}>
                <RouterNavLink to={link.to}>{link.label}</RouterNavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
