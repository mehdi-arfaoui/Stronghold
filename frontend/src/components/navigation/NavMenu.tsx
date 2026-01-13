import { NavLink as RouterNavLink } from "react-router-dom";
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
}

export function NavMenu({
  links = [],
  groups = [],
  onNavigate,
  variant = "horizontal",
  ariaLabel = "Navigation principale",
}: NavMenuProps) {
  const hasGroups = groups.length > 0;
  const renderLinks = (items: NavLink[]) => (
    <ul>
      {items.map((link) => (
        <li key={link.id}>
          <RouterNavLink
            to={link.to}
            className={({ isActive }) => (isActive ? "active" : undefined)}
            onClick={onNavigate}
          >
            {link.label}
          </RouterNavLink>
        </li>
      ))}
    </ul>
  );

  return (
    <nav className={`nav-menu ${variant}`} aria-label={ariaLabel}>
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
