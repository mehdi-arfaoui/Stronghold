import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { getHomeSteps } from "../../constants/homeSteps";
import { TRANSLATIONS } from "../../i18n/translations";

describe("HomePage", () => {
  it("triggers the step action when clicking a step button", async () => {
    const onStepAction = vi.fn();
    const user = userEvent.setup();
    const steps = getHomeSteps("fr");

    render(
      <HomePage
        copy={TRANSLATIONS.fr}
        eyebrow="Accueil"
        title="Premiers pas"
        subtitle="Suivez le guide"
        steps={steps}
        activeStepId="services"
        completedSteps={[]}
        onStepAction={onStepAction}
      />
    );

    const button = screen.getByRole("button", { name: "Créer un service" });
    await user.click(button);

    expect(onStepAction).toHaveBeenCalledWith("services");
  });
});
