import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Header } from "./Header";
import type { NavLink } from "./NavMenu";

const links: NavLink[] = [
  { id: "home", label: "Accueil", href: "#home" },
  { id: "services", label: "Services", href: "#services" },
];

describe("Header", () => {
  it("calls navigation handlers", async () => {
    const onNavigate = vi.fn();
    const onMenuToggle = vi.fn();
    const onQuickAction = vi.fn();
    const user = userEvent.setup();

    render(
      <Header
        links={links}
        activeId="home"
        isMenuOpen={false}
        onMenuToggle={onMenuToggle}
        onNavigate={onNavigate}
        onQuickAction={onQuickAction}
      />
    );

    await user.click(screen.getByRole("link", { name: "Services" }));
    expect(onNavigate).toHaveBeenCalledWith("services");

    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(onMenuToggle).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Démarrer un PRA" }));
    expect(onQuickAction).toHaveBeenCalled();
  });
});
