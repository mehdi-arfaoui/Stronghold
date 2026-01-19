import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { getHomeSteps } from "../../constants/homeSteps";
import i18n from "../../i18n";

describe("HomePage", () => {
  it("triggers the step action when clicking a step button", async () => {
    const onStepAction = vi.fn();
    const user = userEvent.setup();
    const t = i18n.t.bind(i18n);
    const steps = getHomeSteps(t);

    render(
      <HomePage
        eyebrow={t("homeEyebrow")}
        title={t("homeTitle")}
        subtitle={t("homeSubtitle")}
        steps={steps}
        activeStepId="discovery"
        completedSteps={[]}
        maxAllowedIndex={0}
        onStepAction={onStepAction}
      />
    );

    const button = screen.getByRole("button", { name: t("homeSteps.discovery.actionLabel") });
    await user.click(button);

    expect(onStepAction).toHaveBeenCalledWith("discovery");
  });
});
