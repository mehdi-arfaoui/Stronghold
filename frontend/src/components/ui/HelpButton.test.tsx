import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HelpButton } from "./HelpButton";

describe("HelpButton", () => {
  it("toggles contextual help content", async () => {
    const user = userEvent.setup();
    render(
      <HelpButton title="Aides">
        <p>Contenu d'aide</p>
      </HelpButton>
    );

    expect(screen.queryByText("Contenu d'aide")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Aide ?" }));
    expect(screen.getByText("Contenu d'aide")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Masquer l'aide" }));
    expect(screen.queryByText("Contenu d'aide")).not.toBeInTheDocument();
  });
});
