import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { AppLayout } from "./AppLayout";
import { getHomeSteps } from "../../constants/homeSteps";
import { getMainNavGroups } from "../../constants/navigation";
import i18n from "../../i18n";

describe("AppLayout", () => {
  it("renders sidebar navigation and layout structure", () => {
    const t = i18n.t.bind(i18n);
    const steps = getHomeSteps(t);
    const groups = getMainNavGroups(t);

    render(
      <MemoryRouter>
        <AppLayout
          groups={groups}
          steps={steps}
          activeStepId={steps[0].id}
          completedSteps={[steps[0].id]}
          maxAllowedIndex={0}
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

    expect(screen.getByRole("button", { name: t("navigation") })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: t("sidebarTitle") })
    ).toBeInTheDocument();
    expect(document.querySelector(".app-body")).toHaveClass("sidebar-closed");
  });

  it("toggles the menu button", async () => {
    const t = i18n.t.bind(i18n);
    const steps = getHomeSteps(t);
    const groups = getMainNavGroups(t);
    const onMenuToggle = vi.fn();
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <AppLayout
          groups={groups}
          steps={steps}
          activeStepId={steps[0].id}
          completedSteps={[steps[0].id]}
          maxAllowedIndex={0}
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

    await user.click(screen.getByRole("button", { name: t("navigation") }));
    expect(onMenuToggle).toHaveBeenCalledTimes(1);
  });
});
