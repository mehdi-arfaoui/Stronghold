export interface NavLink {
  id: string;
  label: string;
  href: string;
}

interface NavMenuProps {
  links: NavLink[];
  activeId: string;
  onNavigate: (id: string) => void;
  variant?: "horizontal" | "vertical";
}

export function NavMenu({
  links,
  activeId,
  onNavigate,
  variant = "horizontal",
}: NavMenuProps) {
  return (
    <nav className={`nav-menu ${variant}`} aria-label="Navigation principale">
      <ul>
        {links.map((link) => {
          const isActive = link.id === activeId;
          return (
            <li key={link.id}>
              <a
                href={link.href}
                className={isActive ? "active" : undefined}
                aria-current={isActive ? "page" : undefined}
                onClick={() => onNavigate(link.id)}
              >
                {link.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
