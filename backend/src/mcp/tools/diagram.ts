import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  McpToolError,
  requireScope,
  runTool,
  type McpContext,
} from "../context";
import { createDrawingRecord, describeDrawing } from "../drawingStore";
import { addSkeletons } from "../skeleton";
import type { ExcalidrawElement } from "../geometry";
import {
  diagramDirectionSchema,
  diagramEdgeSchema,
  diagramNodeSchema,
  layoutDiagram,
} from "../layout";

export const registerDiagramTools = (server: McpServer, ctx: McpContext) => {
  server.registerTool(
    "create_diagram",
    {
      title: "Create diagram",
      description:
        "Create a new drawing from a graph of nodes and edges, laid out automatically. " +
        "Best for flowcharts, architecture and sequence-of-steps diagrams.",
      inputSchema: {
        name: z.string().min(1).max(255),
        collectionId: z.string().optional(),
        direction: diagramDirectionSchema
          .optional()
          .describe("TB (top-bottom, default), LR, BT or RL."),
        nodes: z.array(diagramNodeSchema).min(1).max(500),
        edges: z.array(diagramEdgeSchema).max(1000).optional(),
      },
    },
    runTool(async ({ name, collectionId, direction, nodes, edges = [] }) => {
      requireScope(ctx, "drawings:write");
      const nodeIds = new Set<string>();
      for (const node of nodes) {
        if (nodeIds.has(node.id))
          throw new McpToolError(`Duplicate node id "${node.id}".`);
        nodeIds.add(node.id);
      }
      for (const edge of edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          throw new McpToolError(
            `Edge ${edge.from} -> ${edge.to} references an unknown node.`,
          );
        }
      }
      const scene: ExcalidrawElement[] = [];
      addSkeletons(scene, layoutDiagram(nodes, edges, direction));
      const drawing = await createDrawingRecord(ctx, {
        name,
        collectionId,
        elements: scene,
      });
      return { ...describeDrawing(ctx, drawing), nodeIds: [...nodeIds] };
    }),
  );
};
