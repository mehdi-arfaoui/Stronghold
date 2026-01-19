import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, test, vi } from "vitest";
import { NavigationPage } from "./NavigationPage";
import { getWizardStepGroup } from "../constants/navigation";
import i18n from "../i18n";

const t = i18n.t.bind(i18n);
const wizardGroup = getWizardStepGroup(t);

describe("NavigationPage", () => {
  test("filtre les onglets via la recherche", async () => {
    const user = userEvent.setup();
    const handleNavigate = vi.fn();

    render(
      <NavigationPage
        activeTab="discovery"
        onNavigateTab={handleNavigate}
        wizardGroup={wizardGroup}
      />
    );

    const searchInput = screen.getByLabelText(t("navigationSearchLabel"));
    const ragLabel = wizardGroup.tabs.find((route) => route.id === "rag")?.label ?? "RAG";
    const discoveryLabel =
      wizardGroup.tabs.find((route) => route.id === "discovery")?.label ?? "Découverte";

    await user.type(searchInput, ragLabel.split(" ")[0]);

    expect(screen.getByText(ragLabel)).toBeInTheDocument();
    expect(screen.queryByText(discoveryLabel)).not.toBeInTheDocument();
  });

  test("affiche un état vide quand aucun module ne correspond", async () => {
    const user = userEvent.setup();

    render(
      <NavigationPage
        activeTab="discovery"
        onNavigateTab={vi.fn()}
        wizardGroup={wizardGroup}
      />
    );

    const searchInput = screen.getByLabelText(t("navigationSearchLabel"));
    await user.type(searchInput, "inexistant");

    expect(screen.getByText(t("navigationEmptyState"))).toBeInTheDocument();
  });

  test("passe un audit axe sans violations critiques", async () => {
    const { container } = render(
      <NavigationPage
        activeTab="discovery"
        onNavigateTab={vi.fn()}
        wizardGroup={wizardGroup}
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
