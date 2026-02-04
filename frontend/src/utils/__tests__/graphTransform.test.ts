import { describe, expect, it } from "vitest";
import { buildCytoscapeElements, normalizeGraphResponse } from "../graphTransform";
import type { GraphApiResponse } from "../../types";

describe("graphTransform", () => {
  it("normalizes graph response into infrastructure data", () => {
    const response: GraphApiResponse = {
      nodes: [
        {
          id: "svc-1",
          label: "Service 1",
          type: "service",
          criticality: "High",
          rtoHours: null,
          rpoMinutes: null,
          mtpdHours: null,
          dependsOnCount: 2,
          usedByCount: 1,
        },
        {
          id: "app-1",
          label: "App 1",
          type: "application",
          nodeKind: "application",
          criticality: "low",
          rtoHours: null,
          rpoMinutes: null,
          mtpdHours: null,
        },
      ],
      edges: [
        {
          id: "edge-1",
          from: "svc-1",
          to: "app-1",
          type: "DEPENDS_ON",
        },
      ],
    };

    const data = normalizeGraphResponse(response);
    expect(data.nodes).toHaveLength(2);
    expect(data.nodes[0].type).toBe("service");
    expect(data.nodes[1].type).toBe("application");
    expect(data.edges[0].source).toBe("svc-1");
  });

  it("builds cytoscape elements with degrees", () => {
    const response: GraphApiResponse = {
      nodes: [
        {
          id: "a",
          label: "A",
          type: "service",
          criticality: "low",
          rtoHours: null,
          rpoMinutes: null,
          mtpdHours: null,
        },
        {
          id: "b",
          label: "B",
          type: "service",
          criticality: "critical",
          rtoHours: null,
          rpoMinutes: null,
          mtpdHours: null,
        },
      ],
      edges: [
        {
          id: "edge-a-b",
          from: "a",
          to: "b",
          type: "DEPENDS_ON",
          edgeWeight: 2,
        },
      ],
    };
    const data = normalizeGraphResponse(response);
    const elements = buildCytoscapeElements(data);
    const nodeElement = elements.find((el) => el.data?.id === "a");
    const edgeElement = elements.find((el) => el.data?.id === "edge-a-b");
    expect(nodeElement?.data?.degree).toBe(1);
    expect(edgeElement?.data?.weight).toBe(2);
  });
});
