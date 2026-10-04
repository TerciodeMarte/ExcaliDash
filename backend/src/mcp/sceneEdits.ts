import { z } from "zod";
import { McpToolError } from "./context";
import {
  COLOR_NAMES,
  NAMED_COLORS,
  bumpVersion,
  measureText,
  placeBoundText,
  routeArrow,
  type ExcalidrawElement,
} from "./geometry";

const hexColor = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|transparent)$/,
    "Use a hex color or 'transparent'",
  );

export const elementPatchSchema = z.object({
  id: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().positive().max(20000).optional(),
  height: z.number().positive().max(20000).optional(),
  label: z
    .string()
    .max(5000)
    .optional()
    .describe(
      "New text: for text elements replaces the text, for shapes/arrows replaces the label.",
    ),
  color: z.enum(COLOR_NAMES).optional(),
  strokeColor: hexColor.optional(),
  backgroundColor: hexColor.optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  opacity: z.number().min(0).max(100).optional(),
  locked: z.boolean().optional(),
});

export type ElementPatch = z.infer<typeof elementPatchSchema>;

const indexLive = (scene: ExcalidrawElement[]) =>
  new Map(
    scene.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const),
  );

const boundTextOf = (
  scene: ExcalidrawElement[],
  container: ExcalidrawElement,
) =>
  scene.find(
    (el) =>
      !el.isDeleted && el.type === "text" && el.containerId === container.id,
  );

const setText = (el: ExcalidrawElement, text: string) => {
  const size = measureText(text, el.fontSize);
  el.text = text;
  el.originalText = text;
  el.width = size.width;
  el.height = size.height;
};

// Re-attach arrows (and their labels) bound to any of `movedIds`.
const rerouteArrows = (
  scene: ExcalidrawElement[],
  live: Map<string, ExcalidrawElement>,
  movedIds: Set<string>,
) => {
  for (const el of scene) {
    if (el.isDeleted || (el.type !== "arrow" && el.type !== "line")) continue;
    const startId = el.startBinding?.elementId;
    const endId = el.endBinding?.elementId;
    if (!movedIds.has(startId) && !movedIds.has(endId) && !movedIds.has(el.id))
      continue;
    routeArrow(el, live.get(startId), live.get(endId));
    bumpVersion(el);
    const label = boundTextOf(scene, el);
    if (label) {
      placeBoundText(label, el);
      bumpVersion(label);
    }
  }
};

export const applyPatches = (
  scene: ExcalidrawElement[],
  patches: ElementPatch[],
): string[] => {
  const live = indexLive(scene);
  const moved = new Set<string>();
  for (const patch of patches) {
    const el = live.get(patch.id);
    if (!el) throw new McpToolError(`Element "${patch.id}" not found.`);
    const dx = patch.x !== undefined ? patch.x - el.x : 0;
    const dy = patch.y !== undefined ? patch.y - el.y : 0;
    if (patch.x !== undefined) el.x = patch.x;
    if (patch.y !== undefined) el.y = patch.y;
    if (patch.width !== undefined) el.width = patch.width;
    if (patch.height !== undefined) el.height = patch.height;
    const named = patch.color ? NAMED_COLORS[patch.color] : undefined;
    const isLinearOrText = ["arrow", "line", "text"].includes(el.type);
    const stroke = patch.strokeColor ?? named?.stroke;
    if (stroke) el.strokeColor = stroke;
    if (patch.backgroundColor) el.backgroundColor = patch.backgroundColor;
    else if (named && !isLinearOrText) el.backgroundColor = named.fill;
    if (patch.strokeStyle) el.strokeStyle = patch.strokeStyle;
    if (patch.opacity !== undefined) el.opacity = patch.opacity;
    if (patch.locked !== undefined) el.locked = patch.locked;

    const bound = el.type === "text" ? undefined : boundTextOf(scene, el);
    if (patch.label !== undefined) {
      if (el.type === "text") setText(el, patch.label);
      else if (bound) setText(bound, patch.label);
      else
        throw new McpToolError(
          `Element "${patch.id}" has no label; add a text element instead.`,
        );
    }
    if (bound) {
      placeBoundText(bound, el);
      bumpVersion(bound);
    }
    if (
      dx !== 0 ||
      dy !== 0 ||
      patch.width !== undefined ||
      patch.height !== undefined
    ) {
      moved.add(el.id);
    }
    bumpVersion(el);
  }
  rerouteArrows(scene, live, moved);
  return patches.map((p) => p.id);
};

export const deleteElements = (
  scene: ExcalidrawElement[],
  ids: string[],
): string[] => {
  const live = indexLive(scene);
  const toDelete = new Set<string>();
  for (const id of ids) {
    if (!live.has(id)) throw new McpToolError(`Element "${id}" not found.`);
    toDelete.add(id);
  }
  // Labels go with their container.
  for (const el of scene) {
    if (el.containerId && toDelete.has(el.containerId)) toDelete.add(el.id);
  }
  for (const el of scene) {
    if (toDelete.has(el.id)) {
      el.isDeleted = true;
      bumpVersion(el);
      continue;
    }
    let changed = false;
    if (el.startBinding && toDelete.has(el.startBinding.elementId)) {
      el.startBinding = null;
      changed = true;
    }
    if (el.endBinding && toDelete.has(el.endBinding.elementId)) {
      el.endBinding = null;
      changed = true;
    }
    if (
      Array.isArray(el.boundElements) &&
      el.boundElements.some((r: { id: string }) => toDelete.has(r.id))
    ) {
      el.boundElements = el.boundElements.filter(
        (r: { id: string }) => !toDelete.has(r.id),
      );
      changed = true;
    }
    if (el.frameId && toDelete.has(el.frameId)) {
      el.frameId = null;
      changed = true;
    }
    if (changed) bumpVersion(el);
  }
  return [...toDelete];
};

const round = (n: unknown) => (typeof n === "number" ? Math.round(n) : n);

// Compact, model-friendly view of a scene: labels are folded into their container.
export const summarizeScene = (scene: ExcalidrawElement[]) => {
  const live = scene.filter((el) => !el.isDeleted);
  const labels = new Map<string, string>();
  for (const el of live) {
    if (el.type === "text" && el.containerId)
      labels.set(el.containerId, el.text);
  }
  return live
    .filter((el) => !(el.type === "text" && el.containerId))
    .map((el) => {
      const item: Record<string, unknown> = {
        id: el.id,
        type: el.type,
        x: round(el.x),
        y: round(el.y),
        width: round(el.width),
        height: round(el.height),
      };
      if (el.type === "text") item.text = el.text;
      if (labels.has(el.id)) item.label = labels.get(el.id);
      if (el.startBinding?.elementId) item.start = el.startBinding.elementId;
      if (el.endBinding?.elementId) item.end = el.endBinding.elementId;
      if (el.frameId) item.frameId = el.frameId;
      if (el.type === "frame" && el.name) item.name = el.name;
      if (el.strokeColor && el.strokeColor !== "#1e1e1e")
        item.strokeColor = el.strokeColor;
      if (el.backgroundColor && el.backgroundColor !== "transparent")
        item.backgroundColor = el.backgroundColor;
      return item;
    });
};
