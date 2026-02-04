import { describe, expect, it, vi } from "vitest";
import { createInteractionHandlers } from "../graphInteractions";

describe("graphInteractions", () => {
  it("invokes hover and zoom callbacks", () => {
    const onHover = vi.fn();
    const onZoom = vi.fn();
    const handlers = createInteractionHandlers({
      onNodeHover: onHover,
      onZoom,
    });

    handlers.handleHover({ id: "node-1" });
    handlers.handleZoom(1.5);

    expect(onHover).toHaveBeenCalledWith({ id: "node-1" });
    expect(onZoom).toHaveBeenCalledWith(1.5);
  });

  it("detects double tap for focus", () => {
    const onFocus = vi.fn();
    const onSelect = vi.fn();
    const handlers = createInteractionHandlers({
      onNodeSelect: onSelect,
      onFocusSubgraph: onFocus,
    });

    const now = Date.now();
    vi.spyOn(Date, "now").mockImplementationOnce(() => now).mockImplementationOnce(() => now + 200);

    handlers.handleTap({ id: "node-2" });
    handlers.handleTap({ id: "node-2" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});
