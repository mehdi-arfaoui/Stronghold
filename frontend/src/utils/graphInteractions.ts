export type GraphInteractionCallbacks<TNode> = {
  onNodeSelect?: (node: TNode) => void;
  onNodeHover?: (node: TNode | null) => void;
  onZoom?: (zoom: number) => void;
  onFocusSubgraph?: (node: TNode) => void;
};

export function createInteractionHandlers<TNode>(callbacks: GraphInteractionCallbacks<TNode>) {
  let lastTapAt = 0;
  const doubleTapWindowMs = 300;

  const handleTap = (node: TNode) => {
    const now = Date.now();
    if (now - lastTapAt <= doubleTapWindowMs) {
      callbacks.onFocusSubgraph?.(node);
      lastTapAt = 0;
      return "double";
    }
    callbacks.onNodeSelect?.(node);
    lastTapAt = now;
    return "single";
  };

  const handleHover = (node: TNode | null) => {
    callbacks.onNodeHover?.(node);
  };

  const handleZoom = (zoom: number) => {
    callbacks.onZoom?.(zoom);
  };

  return { handleTap, handleHover, handleZoom };
}
