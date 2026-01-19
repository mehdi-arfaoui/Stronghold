import { NavLink as RouterNavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./NavMenu.css";

export interface NavLink {
  id: string;
  label: string;
  to: string;
}

export interface NavGroup {
  id: string;
  label: string;
  links: NavLink[];
}

interface NavMenuProps {
  links?: NavLink[];
  groups?: NavGroup[];
  onNavigate?: () => void;
  variant?: "horizontal" | "vertical";
  ariaLabel?: string;
  disabled?: boolean;
}

export function NavMenu({
  links = [],
  groups = [],
  onNavigate,
  variant = "horizontal",
  ariaLabel,
  disabled = false,
}: NavMenuProps) {
  const { t } = useTranslation();
  const hasGroups = groups.length > 0;
  const renderLinks = (items: NavLink[]) => (
    <ul>
      {items.map((link) => (
        <li key={link.id}>
          {disabled ? (
            <span className="nav-link disabled" aria-disabled="true">
              {link.label}
            </span>
          ) : (
            <RouterNavLink
              to={link.to}
              className={({ isActive }) => (isActive ? "active" : undefined)}
              onClick={onNavigate}
            >
              {link.label}
            </RouterNavLink>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <nav className={`nav-menu ${variant}`} aria-label={ariaLabel ?? t("sidebarTitle")}>
      {hasGroups ? (
        <div className="nav-menu-groups">
          {groups.map((group) => (
            <div key={group.id} className="nav-menu-group">
              <p className="nav-menu-title">{group.label}</p>
              {renderLinks(group.links)}
            </div>
          ))}
        </div>
      ) : (
        renderLinks(links)
      )}
    </nav>
  );
}
