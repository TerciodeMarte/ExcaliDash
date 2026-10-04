import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireScope, runTool, type McpContext } from "../context";
import { describeDrawing, mutateScene } from "../drawingStore";
import { addSkeletons, skeletonElementSchema } from "../skeleton";
import {
  applyPatches,
  deleteElements,
  elementPatchSchema,
} from "../sceneEdits";

export const registerElementTools = (server: McpServer, ctx: McpContext) => {
  server.registerTool(
    "add_elements",
    {
      title: "Add elements",
      description:
        "Add skeleton elements to an existing drawing. Arrows can connect to new or existing " +
        "element ids via start/end. Call get_drawing first to find free space.",
      inputSchema: {
        drawingId: z.string().min(1),
        elements: z.array(skeletonElementSchema).min(1).max(2000),
      },
    },
    runTool(async ({ drawingId, elements }) => {
      requireScope(ctx, "drawings:write");
      const { drawing, result } = await mutateScene(ctx, drawingId, (scene) =>
        addSkeletons(scene, elements),
      );
      return { ...describeDrawing(ctx, drawing), createdElementIds: result };
    }),
  );

  server.registerTool(
    "update_elements",
    {
      title: "Update elements",
      description:
        "Patch existing elements by id: move (x/y), resize, change label/text, colors, stroke style, " +
        "opacity or lock state. Labels follow their shape and bound arrows are re-routed.",
      inputSchema: {
        drawingId: z.string().min(1),
        updates: z.array(elementPatchSchema).min(1).max(2000),
      },
    },
    runTool(async ({ drawingId, updates }) => {
      requireScope(ctx, "drawings:write");
      const { drawing, result } = await mutateScene(ctx, drawingId, (scene) =>
        applyPatches(scene, updates),
      );
      return { ...describeDrawing(ctx, drawing), updatedElementIds: result };
    }),
  );

  server.registerTool(
    "delete_elements",
    {
      title: "Delete elements",
      description:
        "Delete elements by id. Their labels are removed too, and arrows bound to them are unbound.",
      inputSchema: {
        drawingId: z.string().min(1),
        ids: z.array(z.string().min(1)).min(1).max(2000),
      },
      annotations: { destructiveHint: true },
    },
    runTool(async ({ drawingId, ids }) => {
      requireScope(ctx, "drawings:write");
      const { drawing, result } = await mutateScene(ctx, drawingId, (scene) =>
        deleteElements(scene, ids),
      );
      return { ...describeDrawing(ctx, drawing), deletedElementIds: result };
    }),
  );
};
