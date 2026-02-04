import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import "tippy.js/dist/tippy.css";
import "tippy.js/themes/light-border.css";
import type { Core, ElementDefinition, LayoutOptions, StylesheetCSS } from "cytoscape";
import type { InfrastructureGraphNode } from "../../types/infrastructureGraph";
import { buildNodeTooltip } from "../../utils/graphTransform";
import { createInteractionHandlers } from "../../utils/graphInteractions";

type InfrastructureGraphProps = {
  elements: ElementDefinition[];
  layout?: LayoutOptions;
  styles?: StylesheetCSS[];
  isLoading?: boolean;
  onNodeSelect?: (node: InfrastructureGraphNode) => void;
  onNodeHover?: (node: InfrastructureGraphNode | null) => void;
  onZoom?: (zoom: number) => void;
  onFocusSubgraph?: (node: InfrastructureGraphNode) => void;
  tooltipFormatter?: (node: InfrastructureGraphNode) => string;
};

export type InfrastructureGraphHandle = {
  relayout: () => void;
  fit: () => void;
  exportPng: () => string | null;
  exportSvg: () => string | null;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
};

let cytoscapeExtensionsLoaded = false;

const DEFAULT_LAYOUT: LayoutOptions = {
  name: "cose-bilkent",
  fit: true,
  padding: 32,
  nodeRepulsion: 9000,
  idealEdgeLength: 160,
  edgeElasticity: 0.15,
  gravity: 0.25,
};

const DEFAULT_STYLES: StylesheetCSS[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      color: "#0f172a",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-wrap": "wrap",
      "text-max-width": 120,
      "text-outline-color": "#f8fafc",
      "text-outline-width": 2,
      "background-color": "#94a3b8",
      width: "mapData(degree, 0, 14, 36, 84)",
      height: "mapData(degree, 0, 14, 36, 84)",
      "border-width": 2,
      "border-color": "#0f172a",
    },
  },
  {
    selector: "node[type = 'service']",
    style: {
      shape: "round-rectangle",
    },
  },
  {
    selector: "node[type = 'application']",
    style: {
      shape: "ellipse",
    },
  },
  {
    selector: "node[type = 'infra']",
    style: {
      shape: "hexagon",
    },
  },
  {
    selector: "node[criticality = 'low']",
    style: {
      "background-color": "#22c55e",
      "border-color": "#15803d",
    },
  },
  {
    selector: "node[criticality = 'medium']",
    style: {
      "background-color": "#facc15",
      "border-color": "#a16207",
    },
  },
  {
    selector: "node[criticality = 'high']",
    style: {
      "background-color": "#fb923c",
      "border-color": "#c2410c",
    },
  },
  {
    selector: "node[criticality = 'critical']",
    style: {
      "background-color": "#f87171",
      "border-color": "#b91c1c",
    },
  },
  {
    selector: "edge",
    style: {
      width: "mapData(weight, 1, 6, 1.5, 6)",
      "line-color": "#94a3b8",
      "target-arrow-color": "#94a3b8",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "arrow-scale": 0.9,
      label: "data(type)",
      "font-size": 10,
      "text-rotation": "autorotate",
      "text-margin-y": -4,
      color: "#475569",
      "text-background-color": "#f8fafc",
      "text-background-opacity": 0.9,
      "text-background-padding": 2,
    },
  },
  {
    selector: "edge[weight > 3]",
    style: {
      "line-color": "#f97316",
      "target-arrow-color": "#f97316",
    },
  },
];

export const InfrastructureGraph = forwardRef<InfrastructureGraphHandle, InfrastructureGraphProps>(
  (
    {
      elements,
      layout = DEFAULT_LAYOUT,
      styles = DEFAULT_STYLES,
      isLoading = false,
      onNodeSelect,
      onNodeHover,
      onZoom,
      onFocusSubgraph,
      tooltipFormatter = buildNodeTooltip,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const cyRef = useRef<Core | null>(null);
    const [cyInstance, setCyInstance] = useState<Core | null>(null);
    const [renderProgress, setRenderProgress] = useState<number | null>(null);
    const layoutThrottleRef = useRef<number | null>(null);
    const isMountedRef = useRef(true);

    useEffect(() => {
      isMountedRef.current = true;
      return () => {
        isMountedRef.current = false;
      };
    }, []);

    const createInstance = useCallback(async () => {
      if (!containerRef.current || typeof window === "undefined") return;
      const cytoscapeModule = await import("cytoscape");
      const cytoscape = cytoscapeModule.default;
      if (!cytoscapeExtensionsLoaded) {
        const coseBilkentModule = await import("cytoscape-cose-bilkent");
        const popperModule = await import("cytoscape-popper");
        const svgModule = await import("cytoscape-svg");
        cytoscape.use(coseBilkentModule.default);
        cytoscape.use(popperModule.default);
        cytoscape.use(svgModule.default);
        cytoscapeExtensionsLoaded = true;
      }

      const instance = cytoscape({
        container: containerRef.current,
        elements: [],
        style: styles,
        layout,
        wheelSensitivity: 0.2,
      });

      cyRef.current = instance;
      setCyInstance(instance);
    }, [layout, styles]);

    useEffect(() => {
      void createInstance();
      return () => {
        cyRef.current?.destroy();
        cyRef.current = null;
        setCyInstance(null);
      };
    }, [createInstance]);

    const scheduleLayout = useCallback(
      (nextLayout?: LayoutOptions) => {
        if (!cyInstance) return;
        if (layoutThrottleRef.current) return;
        layoutThrottleRef.current = window.setTimeout(() => {
          layoutThrottleRef.current = null;
          const chosenLayout = nextLayout ?? layout;
          const layoutInstance = cyInstance.layout(chosenLayout);
          layoutInstance.run();
        }, 200);
      },
      [cyInstance, layout]
    );

    const runProgressiveLoad = useCallback(
      async (elementsToRender: ElementDefinition[]) => {
        if (!cyInstance) return;
        const batchSize = elementsToRender.length > 600 ? 200 : elementsToRender.length;
        cyInstance.elements().remove();
        if (batchSize >= elementsToRender.length) {
          cyInstance.add(elementsToRender);
          setRenderProgress(null);
          scheduleLayout();
          return;
        }

        setRenderProgress(0);
        let rendered = 0;
        while (rendered < elementsToRender.length && isMountedRef.current) {
          const chunk = elementsToRender.slice(rendered, rendered + batchSize);
          cyInstance.add(chunk);
          rendered += chunk.length;
          setRenderProgress(Math.round((rendered / elementsToRender.length) * 100));
          await new Promise((resolve) => setTimeout(resolve, 40));
        }
        setRenderProgress(null);
        scheduleLayout();
      },
      [cyInstance, scheduleLayout]
    );

    useEffect(() => {
      if (!cyInstance) return;
      void runProgressiveLoad(elements);
    }, [cyInstance, elements, runProgressiveLoad]);

    useEffect(() => {
      if (!cyInstance) return;
      const { handleTap, handleHover, handleZoom } = createInteractionHandlers<InfrastructureGraphNode>({
        onNodeSelect,
        onNodeHover,
        onZoom,
        onFocusSubgraph,
      });

      const focusOnSubgraph = (node: any) => {
        const neighborhood = node.closedNeighborhood();
        cyInstance.animate(
          {
            fit: { eles: neighborhood, padding: 60 },
          },
          { duration: 300 }
        );
      };

      const makeTooltip = async (node: any) => {
        const tippyModule = await import("tippy.js");
        const { default: tippy } = tippyModule;
        const ref = node.popperRef();
        const dummyDom = document.createElement("div");
        const tip = tippy(dummyDom, {
          getReferenceClientRect: ref.getBoundingClientRect,
          content: tooltipFormatter(node.data() as InfrastructureGraphNode),
          allowHTML: true,
          trigger: "manual",
          placement: "top",
          theme: "light-border",
        });
        node.scratch("_tippy", tip);
        tip.show();
      };

      const destroyTooltip = (node: any) => {
        const tip = node.scratch("_tippy");
        if (tip) {
          tip.destroy();
          node.removeScratch("_tippy");
        }
      };

      const onTap = (event: any) => {
        const result = handleTap(event.target.data() as InfrastructureGraphNode);
        if (result === "double") {
          focusOnSubgraph(event.target);
        }
      };
      const onMouseOver = (event: any) => {
        const nodeData = event.target.data() as InfrastructureGraphNode;
        handleHover(nodeData);
        void makeTooltip(event.target);
      };
      const onMouseOut = (event: any) => {
        handleHover(null);
        destroyTooltip(event.target);
      };
      const onZoomChange = () => handleZoom(cyInstance.zoom());

      cyInstance.on("tap", "node", onTap);
      cyInstance.on("mouseover", "node", onMouseOver);
      cyInstance.on("mouseout", "node", onMouseOut);
      cyInstance.on("zoom", onZoomChange);

      return () => {
        cyInstance.off("tap", "node", onTap);
        cyInstance.off("mouseover", "node", onMouseOver);
        cyInstance.off("mouseout", "node", onMouseOut);
        cyInstance.off("zoom", onZoomChange);
      };
    }, [cyInstance, onFocusSubgraph, onNodeHover, onNodeSelect, onZoom, tooltipFormatter]);

    useImperativeHandle(
      ref,
      () => ({
        relayout: () => scheduleLayout(),
        fit: () => {
          cyInstance?.fit();
        },
        exportPng: () => {
          if (!cyInstance) return null;
          return cyInstance.png({ scale: 2, full: true });
        },
        exportSvg: () => {
          if (!cyInstance) return null;
          const svgFn = (cyInstance as any).svg;
          if (typeof svgFn !== "function") return null;
          return svgFn.call(cyInstance, { scale: 1, full: true }) as string;
        },
        enterFullscreen: () => {
          containerRef.current?.requestFullscreen?.();
        },
        exitFullscreen: () => {
          if (document.fullscreenElement) {
            void document.exitFullscreen();
          }
        },
      }),
      [cyInstance, scheduleLayout]
    );

    const loadingState = useMemo(() => {
      if (isLoading) return "Chargement du graphe...";
      if (renderProgress !== null) return `Initialisation ${renderProgress}%`;
      return null;
    }, [isLoading, renderProgress]);

    return (
      <div className="infrastructure-graph">
        {loadingState ? <div className="graph-loader">{loadingState}</div> : null}
        <div className="graph-canvas" ref={containerRef} />
      </div>
    );
  }
);

InfrastructureGraph.displayName = "InfrastructureGraph";
