import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getUserTrashCollectionId } from "../../routes/dashboard/trash";
import { requireScope, runTool, type McpContext } from "../context";

export const registerCollectionTools = (server: McpServer, ctx: McpContext) => {
  server.registerTool(
    "list_collections",
    {
      title: "List collections",
      description:
        "List the user's collections plus collections shared with them (with their role).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    runTool(async () => {
      requireScope(ctx, "collections:read");
      const trashId = getUserTrashCollectionId(ctx.userId);
      const owned = await ctx.prisma.collection.findMany({
        where: { userId: ctx.userId, id: { notIn: [trashId, "trash"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      });
      const shared = await ctx.prisma.collectionShare.findMany({
        where: { granteeUserId: ctx.userId },
        select: {
          role: true,
          collection: { select: { id: true, name: true } },
        },
      });
      return [
        ...owned.map((c) => ({ ...c, isOwner: true, role: "owner" })),
        ...shared.map((s) => ({
          ...s.collection,
          isOwner: false,
          role: s.role,
        })),
        { id: "trash", name: "Trash", isOwner: true, role: "owner" },
      ];
    }),
  );

  server.registerTool(
    "create_collection",
    {
      title: "Create collection",
      description: "Create a new collection to organize drawings.",
      inputSchema: { name: z.string().trim().min(1).max(100) },
    },
    runTool(async ({ name }) => {
      requireScope(ctx, "collections:write");
      const collection = await ctx.prisma.collection.create({
        data: {
          name: ctx.sanitizeText(name, 100) || "Untitled",
          userId: ctx.userId,
        },
        select: { id: true, name: true },
      });
      return { ...collection, isOwner: true, role: "owner" };
    }),
  );
};
