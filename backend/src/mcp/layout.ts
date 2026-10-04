import dagre from "@dagrejs/dagre";
import { z } from "zod";
import { COLOR_NAMES, sizeForLabel } from "./geometry";
import type { SkeletonElement } from "./skeleton";

export const diagramNodeSchema = z.object({
  id: z
    .string()
    .regex(/^[\w-]{1,64}$/, "ids may only use letters, digits, '_' and '-'"),
  label: z.string().max(500),
  shape: z
    .enum(["rectangle", "ellipse", "diamond"])
    .optional()
    .describe("Defaults to rectangle."),
  color: z.enum(COLOR_NAMES).optional(),
});

export const diagramEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().max(200).optional(),
  style: z.enum(["solid", "dashed", "dotted"]).optional(),
});

export const diagramDirectionSchema = z.enum(["TB", "LR", "BT", "RL"]);

type DiagramNode = z.infer<typeof diagramNodeSchema>;
type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

// Lay out a node/edge graph with dagre and return skeleton elements.
export const layoutDiagram = (
  nodes: DiagramNode[],
  edges: DiagramEdge[],
  direction: z.infer<typeof diagramDirectionSchema> = "TB",
  origin = { x: 0, y: 0 },
): SkeletonElement[] => {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 90,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    const size = sizeForLabel(node.label);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }
  edges.forEach((edge, i) => {
    // Edge labels need room between ranks.
    graph.setEdge(
      edge.from,
      edge.to,
      edge.label ? { width: edge.label.length * 9, height: 30 } : {},
      `e${i}`,
    );
  });
  dagre.layout(graph);

  const skeletons: SkeletonElement[] = nodes.map((node) => {
    const placed = graph.node(node.id) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return {
      type: node.shape ?? "rectangle",
      id: node.id,
      x: Math.round(origin.x + placed.x - placed.width / 2),
      y: Math.round(origin.y + placed.y - placed.height / 2),
      width: placed.width,
      height: placed.height,
      label: node.label,
      color: node.color,
    };
  });
  for (const edge of edges) {
    skeletons.push({
      type: "arrow",
      start: edge.from,
      end: edge.to,
      label: edge.label,
      strokeStyle: edge.style,
    });
  }
  return skeletons;
};
