/**
 * The graph instance interface used throughout the Stronghold platform.
 * This is a facade over the graphology library, allowing the core engine
 * to work without a direct dependency on graphology internals.
 */
export interface GraphInstance {
  readonly order: number;
  readonly size: number;
  addNode(key: string, attrs?: Record<string, unknown>): string;
  addEdgeWithKey(
    key: string,
    source: string,
    target: string,
    attrs?: Record<string, unknown>,
  ): string;
  hasNode(key: string): boolean;
  hasEdge(key: string): boolean;
  dropEdge(key: string): void;
  getNodeAttributes(key: string): Record<string, unknown>;
  getEdgeAttributes(key: string): Record<string, unknown>;
  setNodeAttribute(key: string, attr: string, value: unknown): void;
  outNeighbors(key: string): string[];
  inNeighbors(key: string): string[];
  outEdges(key: string): string[];
  inDegree(key: string): number;
  outDegree(key: string): number;
  nodes(): string[];
  edges(): string[];
  source(edge: string): string;
  target(edge: string): string;
  forEachNode(callback: (key: string, attrs: Record<string, unknown>) => void): void;
  forEachEdge(
    keyOrCallback:
      | string
      | ((
          key: string,
          attrs: Record<string, unknown>,
          source: string,
          target: string,
          sourceAttrs: Record<string, unknown>,
          targetAttrs: Record<string, unknown>,
        ) => void),
    callback?: (
      key: string,
      attrs: Record<string, unknown>,
      source: string,
      target: string,
      sourceAttrs: Record<string, unknown>,
      targetAttrs: Record<string, unknown>,
    ) => void,
  ): void;
  copy(): GraphInstance;
}
