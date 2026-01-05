import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsSection } from "../DocumentsSection";
import { apiFetch, apiFetchFormData } from "../../utils/api";

vi.mock("../../utils/api", () => ({
  apiFetch: vi.fn(),
  apiFetchFormData: vi.fn(),
}));

const apiFetchMock = vi.mocked(apiFetch);
const apiFetchFormDataMock = vi.mocked(apiFetchFormData);

describe("DocumentsSection", () => {
  beforeEach(() => {
    apiFetchMock.mockResolvedValue([]);
    apiFetchFormDataMock.mockResolvedValue({});
  });

  it("renders documents panel and validates missing upload file", async () => {
    render(<DocumentsSection configVersion={1} />);

    expect(await screen.findByRole("heading", { name: "Documents" })).toBeInTheDocument();

    const ingestButton = screen.getByRole("button", { name: "Importer et indexer" });
    fireEvent.click(ingestButton);

    expect(
      await screen.findByText("Sélectionnez un fichier avant l'envoi.")
    ).toBeInTheDocument();
    expect(apiFetchFormDataMock).not.toHaveBeenCalled();
  });
});
