import { NavLink as RouterNavLink } from "react-router-dom";
import type { NavGroup } from "../navigation/NavMenu";
import { useTranslation } from "react-i18next";

interface FooterProps {
  groups: NavGroup[];
}

export function Footer({ groups }: FooterProps) {
  const { t } = useTranslation();
  return (
    <footer className="site-footer" aria-labelledby="footer-title">
      <div className="footer-inner">
        <div>
          <p id="footer-title" className="footer-title">
            {t("footerTitle")}
          </p>
          <p className="muted">{t("footerDescription")}</p>
        </div>
        <nav className="footer-nav" aria-label={t("footerNavLabel")}>
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
