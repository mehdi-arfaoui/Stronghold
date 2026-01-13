import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, test, vi } from "vitest";
import { NavigationPage } from "./NavigationPage";
import { getModuleGroups, getModuleRoutes, getWizardStepGroup } from "../constants/navigation";
import { getCopy } from "../i18n/utils";

const language = "fr";
const copy = getCopy(language);
const moduleGroups = getModuleGroups(language);
const moduleRoutes = getModuleRoutes(language);
const wizardGroup = getWizardStepGroup(language);

describe("NavigationPage", () => {
  test("filtre les onglets via la recherche", async () => {
    const user = userEvent.setup();
    const handleNavigate = vi.fn();

    render(
      <NavigationPage
        activeTab="services"
        onNavigateTab={handleNavigate}
        copy={copy}
        wizardGroup={wizardGroup}
        moduleGroups={moduleGroups}
        moduleRoutes={moduleRoutes}
      />
    );

    const searchInput = screen.getByLabelText(copy.navigationSearchLabel);
    const ragLabel = moduleRoutes.find((route) => route.id === "rag")?.label ?? "RAG";
    const servicesLabel =
      moduleRoutes.find((route) => route.id === "services")?.label ?? "Services";

    await user.type(searchInput, ragLabel.split(" ")[0]);

    expect(screen.getByText(ragLabel)).toBeInTheDocument();
    expect(screen.queryByText(servicesLabel)).not.toBeInTheDocument();
  });

  test("affiche un état vide quand aucun module ne correspond", async () => {
    const user = userEvent.setup();

    render(
      <NavigationPage
        activeTab="services"
        onNavigateTab={vi.fn()}
        copy={copy}
        wizardGroup={wizardGroup}
        moduleGroups={moduleGroups}
        moduleRoutes={moduleRoutes}
      />
    );

    const searchInput = screen.getByLabelText(copy.navigationSearchLabel);
    await user.type(searchInput, "inexistant");

    expect(screen.getByText(copy.navigationEmptyState)).toBeInTheDocument();
    expect(screen.getByText(copy.navigationGroupEmptyState)).toBeInTheDocument();
  });

  test("passe un audit axe sans violations critiques", async () => {
    const { container } = render(
      <NavigationPage
        activeTab="services"
        onNavigateTab={vi.fn()}
        copy={copy}
        wizardGroup={wizardGroup}
        moduleGroups={moduleGroups}
        moduleRoutes={moduleRoutes}
      />
    );

    const results = await axe.run(container, {
      rules: {
        "color-contrast": { enabled: false },
      },
    });
    expect(results.violations).toHaveLength(0);
  });
});
