import { v4 as uuidv4 } from "uuid";
import {
  canEditDrawing,
  canViewDrawing,
  getDrawingAccess,
  type DrawingAccess,
} from "../authz/sharing";
import { sanitizeDrawingData } from "../security";
import {
  applySceneUpdateTx,
  isVersionConflict,
} from "../routes/dashboard/sceneUpdate";
import {
  isTrashCollectionId,
  toInternalTrashCollectionId,
  toPublicTrashCollectionId,
} from "../routes/dashboard/trash";
import { McpToolError, drawingUrl, type McpContext } from "./context";
import type { ExcalidrawElement } from "./geometry";
import { syncFractionalIndices } from "./fractionalIndex";

const NOT_FOUND = "Drawing not found or you do not have access to it.";

export const requireDrawingAccess = async (
  ctx: McpContext,
  drawingId: string,
  need: "view" | "edit",
): Promise<DrawingAccess> => {
  const access = await getDrawingAccess({
    prisma: ctx.prisma,
    principal: { kind: "user", userId: ctx.userId },
    drawingId,
  });
  const allowed =
    need === "edit" ? canEditDrawing(access) : canViewDrawing(access);
  if (!allowed) throw new McpToolError(NOT_FOUND);
  return access;
};

// Resolves a public collection id ("trash", null, or an id) to the stored id,
// checking the caller may add drawings to it.
export const resolveTargetCollection = async (
  ctx: McpContext,
  collectionId: string | null | undefined,
  options: { ownOnly?: boolean } = {},
): Promise<string | null> => {
  if (!collectionId) return null;
  const internalId =
    toInternalTrashCollectionId(collectionId, ctx.userId) ?? null;
  if (isTrashCollectionId(internalId, ctx.userId)) {
    await ctx.ensureTrashCollection(ctx.prisma, ctx.userId);
    return internalId;
  }
  const collection = await ctx.prisma.collection.findFirst({
    where: { id: internalId! },
  });
  if (!collection) throw new McpToolError("Collection not found.");
  if (collection.userId !== ctx.userId) {
    if (options.ownOnly)
      throw new McpToolError(
        "Drawings can only be moved into your own collections.",
      );
    const share = await ctx.prisma.collectionShare.findFirst({
      where: {
        collectionId: collection.id,
        granteeUserId: ctx.userId,
        role: "edit",
      },
    });
    if (!share)
      throw new McpToolError("You do not have edit access to this collection.");
  }
  return collection.id;
};

const sanitizeScene = (
  elements: ExcalidrawElement[],
  appState: Record<string, unknown>,
) => {
  try {
    syncFractionalIndices(elements);
    return sanitizeDrawingData({ elements, appState, files: {} });
  } catch (error) {
    if (error instanceof Error && !(error instanceof McpToolError)) {
      throw new McpToolError(error.message);
    }
    throw error;
  }
};

// Push the committed scene to open editors, like an autosave echo: they
// reconcile it by element version instead of reloading, so unsaved local
// edits survive. Deletions arrive as tombstones. Files are never touched by
// MCP, so they are omitted.
export const notifyDrawingChanged = (
  ctx: McpContext,
  drawingId: string,
  elements: ExcalidrawElement[],
) => {
  ctx.io?.to(`drawing_${drawingId}`).emit("element-update", {
    drawingId,
    persisted: true,
    elements,
    elementOrder: elements.map((element) => element.id),
  });
};

export const describeDrawing = (
  ctx: McpContext,
  drawing: {
    id: string;
    name: string;
    collectionId: string | null;
    userId: string;
    version: number;
    updatedAt: Date;
  },
) => ({
  id: drawing.id,
  name: drawing.name,
  collectionId:
    toPublicTrashCollectionId(drawing.collectionId, drawing.userId) ?? null,
  version: drawing.version,
  updatedAt: drawing.updatedAt.toISOString(),
  url: drawingUrl(ctx, drawing.id),
});

export const createDrawingRecord = async (
  ctx: McpContext,
  input: {
    name: string;
    collectionId?: string | null;
    elements: ExcalidrawElement[];
  },
) => {
  const collectionId = await resolveTargetCollection(ctx, input.collectionId);
  const sanitized = sanitizeScene(input.elements, {});
  const drawing = await ctx.prisma.drawing.create({
    data: {
      id: uuidv4(),
      name: ctx.sanitizeText(input.name, 255) || "Untitled Drawing",
      elements: JSON.stringify(sanitized.elements),
      appState: JSON.stringify(sanitized.appState),
      files: "{}",
      userId: ctx.userId,
      collectionId,
      preview: null,
    },
  });
  ctx.invalidateDrawingsCache();
  return drawing;
};

/**
 * Read-modify-write of a drawing's elements inside the versioned scene
 * transaction (snapshot + version bump + optimistic retry). `mutate` receives
 * a fresh copy of the current elements on every attempt.
 */
export const mutateScene = async <T>(
  ctx: McpContext,
  drawingId: string,
  mutate: (elements: ExcalidrawElement[]) => T,
) => {
  await requireDrawingAccess(ctx, drawingId, "edit");
  let result: T | undefined;
  try {
    const { drawing } = await applySceneUpdateTx({
      prisma: ctx.prisma,
      drawingId,
      parseJsonField: ctx.parseJsonField,
      versionGuard: "optimistic",
      maxRetries: 3,
      mutate: (current) => {
        const elements = ctx.parseJsonField<ExcalidrawElement[]>(
          current.elements,
          [],
        );
        const appState = ctx.parseJsonField<Record<string, unknown>>(
          current.appState,
          {},
        );
        result = mutate(elements);
        const sanitized = sanitizeScene(elements, appState);
        // Drop the stale preview; the dashboard regenerates it from the scene.
        return {
          data: { elements: JSON.stringify(sanitized.elements), preview: null },
        };
      },
    });
    ctx.invalidateDrawingsCache();
    notifyDrawingChanged(
      ctx,
      drawingId,
      ctx.parseJsonField<ExcalidrawElement[]>(drawing.elements, []),
    );
    return { drawing, result: result as T };
  } catch (error) {
    if (isVersionConflict(error)) {
      throw new McpToolError(
        "The drawing is being edited heavily right now; please retry.",
      );
    }
    throw error;
  }
};
