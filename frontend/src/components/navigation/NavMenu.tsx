import { NavLink as RouterNavLink } from "react-router-dom";

export interface NavLink {
  id: string;
  label: string;
  to: string;
}

interface NavMenuProps {
  links: NavLink[];
  onNavigate?: () => void;
  variant?: "horizontal" | "vertical";
}

export function NavMenu({ links, onNavigate, variant = "horizontal" }: NavMenuProps) {
  return (
    <nav className={`nav-menu ${variant}`} aria-label="Navigation principale">
      <ul>
        {links.map((link) => (
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
    </nav>
  );
}
