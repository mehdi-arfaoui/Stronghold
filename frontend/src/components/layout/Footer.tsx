import { NavLink as RouterNavLink } from "react-router-dom";
import type { NavGroup } from "../navigation/NavMenu";

interface FooterProps {
  groups: NavGroup[];
}

export function Footer({ groups }: FooterProps) {
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
          <div className="footer-nav-groups">
            {groups.map((group) => (
              <div key={group.id} className="footer-nav-group">
                <p className="footer-nav-title">{group.label}</p>
                <ul>
                  {group.links.map((link) => (
                    <li key={link.id}>
                      <RouterNavLink to={link.to}>{link.label}</RouterNavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
      </div>
    </footer>
  );
}
