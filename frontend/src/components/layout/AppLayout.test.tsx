import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { AppLayout } from "./AppLayout";
import { getHomeSteps } from "../../constants/homeSteps";
import { getMainNavGroups } from "../../constants/navigation";
import { TRANSLATIONS } from "../../i18n/translations";

describe("AppLayout", () => {
  it("renders sidebar navigation and layout structure", () => {
    const steps = getHomeSteps("fr");
    const groups = getMainNavGroups("fr");

    render(
      <MemoryRouter>
        <AppLayout
          groups={groups}
          copy={TRANSLATIONS.fr}
          steps={steps}
          activeStepId={steps[0].id}
          completedSteps={[steps[0].id]}
          onStepAction={() => undefined}
          onQuickAction={() => undefined}
          theme="light"
          onToggleTheme={() => undefined}
          language="fr"
          onLanguageChange={() => undefined}
          isMenuOpen={false}
          onMenuToggle={() => undefined}
          onMenuClose={() => undefined}
        >
          <div>Content</div>
        </AppLayout>
      </MemoryRouter>
    );

    expect(screen.getByRole("button", { name: TRANSLATIONS.fr.navigation })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: TRANSLATIONS.fr.sidebarTitle })
    ).toBeInTheDocument();
  });

  it("toggles the menu button", async () => {
    const steps = getHomeSteps("fr");
    const groups = getMainNavGroups("fr");
    const onMenuToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AppLayout
          groups={groups}
          copy={TRANSLATIONS.fr}
          steps={steps}
          activeStepId={steps[0].id}
          completedSteps={[steps[0].id]}
          onStepAction={() => undefined}
          onQuickAction={() => undefined}
          theme="light"
          onToggleTheme={() => undefined}
          language="fr"
          onLanguageChange={() => undefined}
          isMenuOpen={false}
          onMenuToggle={onMenuToggle}
          onMenuClose={() => undefined}
        >
          <div>Content</div>
        </AppLayout>
      </MemoryRouter>
    );

    await user.click(screen.getByRole("button", { name: TRANSLATIONS.fr.navigation }));
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });
});
