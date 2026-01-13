import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoverySection } from "./DiscoverySection";

vi.mock("../utils/api", () => ({
  apiFetch: vi.fn().mockResolvedValue([]),
  apiFetchFormData: vi.fn().mockResolvedValue({
    summary: { totalNodes: 0, serviceNodes: 0, infraNodes: 0, edges: 0 },
    suggestions: [],
  }),
}));

describe("DiscoverySection", () => {
  it("renders a non-empty discovery page", async () => {
    render(<DiscoverySection configVersion={0} />);

    expect(screen.getByText("Découverte")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lancer un scan" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Importer un export CSV/JSON" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Importer depuis un dépôt GitHub" })
    ).toBeInTheDocument();
    expect(await screen.findByText("Aucune découverte en cours")).toBeInTheDocument();
  });
});
