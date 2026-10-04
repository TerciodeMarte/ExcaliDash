import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Prisma } from "../../generated/client";
import { getUserTrashCollectionId } from "../../routes/dashboard/trash";
import { isOwnerAccess } from "../../authz/sharing";
import {
  McpToolError,
  requireScope,
  runTool,
  type McpContext,
} from "../context";
import {
  createDrawingRecord,
  describeDrawing,
  mutateScene,
  requireDrawingAccess,
  resolveTargetCollection,
} from "../drawingStore";
import { addSkeletons, skeletonElementSchema } from "../skeleton";
import { deleteElements, summarizeScene } from "../sceneEdits";
import type { ExcalidrawElement } from "../geometry";

const listSelect = {
  id: true,
  name: true,
  collectionId: true,
  userId: true,
  version: true,
  updatedAt: true,
} as const;

export const registerDrawingTools = (server: McpServer, ctx: McpContext) => {
  server.registerTool(
    "list_drawings",
    {
      title: "List drawings",
      description:
        "List the user's drawings (newest first). Filter by name search or collection id " +
        '(use "trash" for the trash, "null" for unfiled). Set shared=true for drawings shared with the user.',
      inputSchema: {
        search: z.string().max(200).optional(),
        collectionId: z.string().optional(),
        shared: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    runTool(
      async ({ search, collectionId, shared, limit = 50, offset = 0 }) => {
        requireScope(ctx, "drawings:read");
        const trashId = getUserTrashCollectionId(ctx.userId);
        let where: Prisma.DrawingWhereInput;
        if (shared) {
          where = {
            permissions: { some: { granteeUserId: ctx.userId, hidden: false } },
          };
        } else if (collectionId === "null") {
          where = { userId: ctx.userId, collectionId: null };
        } else if (collectionId === "trash") {
          where = {
            userId: ctx.userId,
            collectionId: { in: [trashId, "trash"] },
          };
        } else if (collectionId) {
          const collection = await ctx.prisma.collection.findFirst({
            where: { id: collectionId },
          });
          const canSee =
            collection &&
            (collection.userId === ctx.userId ||
              (await ctx.prisma.collectionShare.findFirst({
                where: { collectionId, granteeUserId: ctx.userId },
              })));
          if (!canSee) throw new McpToolError("Collection not found.");
          where = { collectionId };
        } else {
          where = {
            userId: ctx.userId,
            OR: [
              { collectionId: { notIn: [trashId, "trash"] } },
              { collectionId: null },
            ],
          };
        }
        if (search?.trim())
          where = { AND: [where, { name: { contains: search.trim() } }] };

        const [total, drawings] = await Promise.all([
          ctx.prisma.drawing.count({ where }),
          ctx.prisma.drawing.findMany({
            where,
            select: listSelect,
            orderBy: { updatedAt: "desc" },
            take: limit,
            skip: offset,
          }),
        ]);
        return {
          total,
          offset,
          drawings: drawings.map((d) => describeDrawing(ctx, d)),
        };
      },
    ),
  );

  server.registerTool(
    "get_drawing",
    {
      title: "Get drawing",
      description:
        "Get a drawing's metadata and a compact list of its elements (ids, types, positions, labels, " +
        "arrow start/end). Call this before editing so you know element ids and free space. " +
        "Set includeRaw=true for the full Excalidraw element JSON.",
      inputSchema: {
        id: z.string().min(1),
        includeRaw: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    runTool(async ({ id, includeRaw }) => {
      requireScope(ctx, "drawings:read");
      const access = await requireDrawingAccess(ctx, id, "view");
      const drawing = await ctx.prisma.drawing.findUnique({ where: { id } });
      if (!drawing) throw new McpToolError("Drawing not found.");
      const elements = ctx.parseJsonField<ExcalidrawElement[]>(
        drawing.elements,
        [],
      );
      return {
        ...describeDrawing(ctx, drawing),
        access,
        elements: summarizeScene(elements),
        ...(includeRaw
          ? { rawElements: elements.filter((el) => !el.isDeleted) }
          : {}),
      };
    }),
  );

  server.registerTool(
    "create_drawing",
    {
      title: "Create drawing",
      description:
        "Create a new drawing from skeleton elements (free-form). For flowcharts or architecture " +
        "diagrams prefer create_diagram, which lays out nodes automatically.",
      inputSchema: {
        name: z.string().min(1).max(255),
        collectionId: z
          .string()
          .optional()
          .describe("Target collection id; omit for unfiled."),
        elements: z.array(skeletonElementSchema).max(2000).optional(),
      },
    },
    runTool(async ({ name, collectionId, elements = [] }) => {
      requireScope(ctx, "drawings:write");
      const scene: ExcalidrawElement[] = [];
      const createdIds = addSkeletons(scene, elements);
      const drawing = await createDrawingRecord(ctx, {
        name,
        collectionId,
        elements: scene,
      });
      return {
        ...describeDrawing(ctx, drawing),
        createdElementIds: createdIds,
      };
    }),
  );

  server.registerTool(
    "update_drawing",
    {
      title: "Update drawing",
      description:
        'Rename a drawing, move it to another collection (owner only; "trash" to trash it, null to unfile), ' +
        "or replace its whole scene with new skeleton elements (replaceElements).",
      inputSchema: {
        id: z.string().min(1),
        name: z.string().min(1).max(255).optional(),
        collectionId: z.string().nullable().optional(),
        replaceElements: z.array(skeletonElementSchema).max(2000).optional(),
      },
      annotations: { destructiveHint: true },
    },
    runTool(async ({ id, name, collectionId, replaceElements }) => {
      requireScope(ctx, "drawings:write");
      const access = await requireDrawingAccess(ctx, id, "edit");
      const data: Prisma.DrawingUncheckedUpdateInput = {};
      if (name !== undefined)
        data.name = ctx.sanitizeText(name, 255) || "Untitled Drawing";
      if (collectionId !== undefined) {
        if (!isOwnerAccess(access)) {
          throw new McpToolError(
            "Only the owner can move a drawing between collections.",
          );
        }
        data.collectionId = await resolveTargetCollection(ctx, collectionId, {
          ownOnly: true,
        });
      }
      if (Object.keys(data).length > 0) {
        await ctx.prisma.drawing.update({ where: { id }, data });
        ctx.invalidateDrawingsCache();
      }
      let createdElementIds: string[] | undefined;
      if (replaceElements) {
        const { result } = await mutateScene(ctx, id, (elements) => {
          // Keep tombstones so stale collaborators cannot resurrect old elements.
          deleteElements(
            elements,
            elements.filter((el) => !el.isDeleted).map((el) => el.id),
          );
          return addSkeletons(elements, replaceElements);
        });
        createdElementIds = result;
      }
      const drawing = await ctx.prisma.drawing.findUniqueOrThrow({
        where: { id },
      });
      return {
        ...describeDrawing(ctx, drawing),
        ...(createdElementIds ? { createdElementIds } : {}),
      };
    }),
  );
};
