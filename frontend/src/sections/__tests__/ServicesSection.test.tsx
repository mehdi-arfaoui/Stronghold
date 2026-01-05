import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesSection } from "../ServicesSection";
import { apiFetch } from "../../utils/api";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

describe("ServicesSection", () => {
  beforeEach(() => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/services") return Promise.resolve([]);
      if (path === "/infra/components") return Promise.resolve([]);
      return Promise.resolve([]);
    });
  });

  it("renders the services panel and enforces linking validation", async () => {
    render(<ServicesSection configVersion={1} />);

    expect(await screen.findByRole("heading", { name: "Services" })).toBeInTheDocument();
    expect(
      await screen.findByText("Ajoutez un service avant de créer un lien.")
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Ajoutez un composant infra pour créer un lien.")
    ).toBeInTheDocument();

    const linkButton = screen.getByRole("button", { name: "Association" });
    expect(linkButton).toBeDisabled();
  });
});
