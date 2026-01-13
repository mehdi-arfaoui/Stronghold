import { NavLink as RouterNavLink } from "react-router-dom";
import type { NavGroup } from "../navigation/NavMenu";
import type { TranslationCopy } from "../../i18n/translations";

interface FooterProps {
  groups: NavGroup[];
  copy: TranslationCopy;
}

export function Footer({ groups, copy }: FooterProps) {
  return (
    <footer className="site-footer" aria-labelledby="footer-title">
      <div className="footer-inner">
        <div>
          <p id="footer-title" className="footer-title">
            {copy.footerTitle}
          </p>
          <p className="muted">{copy.footerDescription}</p>
        </div>
        <nav className="footer-nav" aria-label={copy.footerNavLabel}>
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
