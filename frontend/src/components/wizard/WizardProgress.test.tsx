import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WizardProgress } from "./WizardProgress";
import { getHomeSteps } from "../../constants/homeSteps";
import { TRANSLATIONS } from "../../i18n/translations";

describe("WizardProgress", () => {
  it("renders progress summary and matches snapshot", () => {
    const steps = getHomeSteps("fr");
    const completedSteps = steps.slice(0, 2).map((step) => step.id);

    const { container } = render(
      <WizardProgress
        copy={TRANSLATIONS.fr}
        steps={steps}
        activeStepId={steps[1].id}
        completedSteps={completedSteps}
        onStepAction={() => undefined}
      />
    );

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toHaveAttribute("aria-valuenow", "29");
    expect(container).toMatchSnapshot();
  });
});
