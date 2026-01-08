import type { NavLink } from "../navigation/NavMenu";

interface FooterProps {
  links: NavLink[];
  onNavigate: (id: string) => void;
}

export function Footer({ links, onNavigate }: FooterProps) {
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
                <a href={link.href} onClick={() => onNavigate(link.id)}>
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
