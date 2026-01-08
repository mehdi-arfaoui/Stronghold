import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";

describe("HomePage", () => {
  it("triggers the step action when clicking a step button", async () => {
    const onStepAction = vi.fn();
    const user = userEvent.setup();

    render(
      <HomePage
        title="Premiers pas"
        subtitle="Suivez le guide"
        activeStepId="services"
        completedSteps={[]}
        onStepAction={onStepAction}
      />
    );

    const button = screen.getByRole("button", { name: "Ajouter un service" });
    await user.click(button);

    expect(onStepAction).toHaveBeenCalledWith("services");
  });
});
