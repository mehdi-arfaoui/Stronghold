import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RagSection } from "../RagSection";
import { apiFetch } from "../../utils/api";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);

describe("RagSection", () => {
  beforeEach(() => {
    apiFetchMock.mockResolvedValue([]);
  });

  it("renders rag panel and validates facts extraction without a document", async () => {
    render(<RagSection configVersion={1} />);

    expect(await screen.findByRole("heading", { name: "Faits IA / RAG" })).toBeInTheDocument();

    const extractButton = screen.getByRole("button", { name: "Extraire les faits" });
    fireEvent.click(extractButton);

    expect(
      await screen.findByText("Sélectionnez un document pour extraire les faits IA.")
    ).toBeInTheDocument();
  });
});
