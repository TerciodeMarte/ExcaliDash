import { z } from "zod";
import { McpToolError } from "./context";
import {
  COLOR_NAMES,
  FONT_FAMILY,
  FONT_SIZE,
  LINE_HEIGHT,
  NAMED_COLORS,
  baseElement,
  bumpVersion,
  measureText,
  placeBoundText,
  routeArrow,
  sizeForLabel,
  type ExcalidrawElement,
} from "./geometry";

const hexColor = z
  .string()
  .regex(
    /^(#[0-9a-fA-F]{3,8}|transparent)$/,
    "Use a hex color or 'transparent'",
  );
const arrowhead = z.enum(["arrow", "triangle", "dot", "bar", "none"]);

export const skeletonElementSchema = z.object({
  type: z.enum([
    "rectangle",
    "ellipse",
    "diamond",
    "text",
    "arrow",
    "line",
    "frame",
  ]),
  id: z
    .string()
    .regex(/^[\w-]{1,64}$/, "ids may only use letters, digits, '_' and '-'")
    .optional()
    .describe(
      "Optional id so other elements (arrows, frames) can reference this one.",
    ),
  x: z
    .number()
    .optional()
    .describe(
      "Left edge in canvas pixels (y grows downward). Optional for bound arrows.",
    ),
  y: z.number().optional(),
  width: z
    .number()
    .positive()
    .max(20000)
    .optional()
    .describe("Auto-sized from the label when omitted."),
  height: z.number().positive().max(20000).optional(),
  label: z
    .string()
    .max(2000)
    .optional()
    .describe("Text centered inside a shape or shown on an arrow."),
  text: z
    .string()
    .max(5000)
    .optional()
    .describe("Content of a standalone text element."),
  fontSize: z.number().min(8).max(120).optional(),
  color: z
    .enum(COLOR_NAMES)
    .optional()
    .describe("Named color: sets stroke and a light fill."),
  strokeColor: hexColor.optional(),
  backgroundColor: hexColor.optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  start: z
    .string()
    .optional()
    .describe("Arrow/line: id of the element it starts from."),
  end: z
    .string()
    .optional()
    .describe("Arrow/line: id of the element it points to."),
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(200)
    .optional()
    .describe(
      "Arrow/line points relative to x/y, used when start/end are not given.",
    ),
  startArrowhead: arrowhead.optional(),
  endArrowhead: arrowhead.optional(),
  name: z.string().max(200).optional().describe("Frame title."),
  children: z
    .array(z.string())
    .max(500)
    .optional()
    .describe("Frame: ids of elements placed inside it."),
});

export type SkeletonElement = z.infer<typeof skeletonElementSchema>;

const LINEAR_TYPES = new Set(["arrow", "line"]);
const ROUNDNESS: Record<string, unknown> = {
  rectangle: { type: 3 },
  diamond: { type: 2 },
  arrow: { type: 2 },
  line: { type: 2 },
};
const FRAME_PADDING = 40;

const colorProps = (skel: SkeletonElement, isShape: boolean) => {
  const named = skel.color ? NAMED_COLORS[skel.color] : undefined;
  const props: Record<string, string> = {};
  const stroke = skel.strokeColor ?? named?.stroke;
  const fill = skel.backgroundColor ?? (isShape ? named?.fill : undefined);
  if (stroke) props.strokeColor = stroke;
  if (fill) props.backgroundColor = fill;
  return props;
};

export const makeTextElement = (
  text: string,
  props: Partial<ExcalidrawElement> & { x: number; y: number },
  fontSize = FONT_SIZE,
): ExcalidrawElement => {
  const size = measureText(text, fontSize);
  return baseElement("text", {
    ...size,
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT_FAMILY,
    textAlign: props.containerId ? "center" : "left",
    verticalAlign: props.containerId ? "middle" : "top",
    containerId: null,
    autoResize: true,
    lineHeight: LINE_HEIGHT,
    ...props,
  });
};

const addBoundRef = (
  el: ExcalidrawElement,
  ref: { id: string; type: string },
) => {
  const refs = Array.isArray(el.boundElements) ? el.boundElements : [];
  if (!refs.some((r: { id: string }) => r.id === ref.id)) {
    el.boundElements = [...refs, ref];
  }
};

// Attach a label as a bound text element right after its container.
const attachLabel = (
  scene: ExcalidrawElement[],
  container: ExcalidrawElement,
  label: string,
  fontSize: number | undefined,
) => {
  const text = makeTextElement(
    label,
    {
      x: 0,
      y: 0,
      containerId: container.id,
      strokeColor:
        container.type === "arrow" ? "#1e1e1e" : container.strokeColor,
    },
    fontSize,
  );
  placeBoundText(text, container);
  addBoundRef(container, { id: text.id, type: "text" });
  scene.splice(scene.indexOf(container) + 1, 0, text);
};

/**
 * Converts skeleton elements into full Excalidraw elements and appends them to
 * `scene` (mutated in place). Arrows may bind to new or existing elements.
 * Returns the ids of the created top-level elements.
 */
export const addSkeletons = (
  scene: ExcalidrawElement[],
  skeletons: SkeletonElement[],
): string[] => {
  const live = new Map(
    scene.filter((el) => !el.isDeleted).map((el) => [el.id, el] as const),
  );
  const createdIds: string[] = [];
  const touched = new Set<string>();

  const claimId = (el: ExcalidrawElement, requested?: string) => {
    if (requested) {
      if (live.has(requested))
        throw new McpToolError(`Element id "${requested}" already exists.`);
      el.id = requested;
    }
    live.set(el.id, el);
    createdIds.push(el.id);
  };

  const ordered = [
    ...skeletons.filter((s) => !LINEAR_TYPES.has(s.type) && s.type !== "frame"),
    ...skeletons.filter((s) => LINEAR_TYPES.has(s.type)),
    ...skeletons.filter((s) => s.type === "frame"),
  ];

  for (const skel of ordered) {
    if (skel.type === "text") {
      const text = makeTextElement(
        skel.text ?? skel.label ?? "",
        {
          x: skel.x ?? 0,
          y: skel.y ?? 0,
          ...colorProps(skel, false),
        },
        skel.fontSize,
      );
      claimId(text, skel.id);
      scene.push(text);
      continue;
    }

    if (LINEAR_TYPES.has(skel.type)) {
      const startEl = skel.start ? live.get(skel.start) : undefined;
      const endEl = skel.end ? live.get(skel.end) : undefined;
      if (skel.start && !startEl)
        throw new McpToolError(`start element "${skel.start}" not found.`);
      if (skel.end && !endEl)
        throw new McpToolError(`end element "${skel.end}" not found.`);
      const isArrow = skel.type === "arrow";
      const el = baseElement(skel.type, {
        x: skel.x ?? 0,
        y: skel.y ?? 0,
        width: skel.width ?? 0,
        height: skel.height ?? 0,
        roundness: ROUNDNESS[skel.type] ?? null,
        strokeStyle: skel.strokeStyle ?? "solid",
        points: skel.points ?? [
          [0, 0],
          [skel.width ?? 150, skel.height ?? 0],
        ],
        lastCommittedPoint: null,
        startBinding: null,
        endBinding: null,
        startArrowhead:
          skel.startArrowhead && skel.startArrowhead !== "none"
            ? skel.startArrowhead
            : null,
        endArrowhead: isArrow
          ? skel.endArrowhead === "none"
            ? null
            : (skel.endArrowhead ?? "arrow")
          : null,
        elbowed: false,
        ...colorProps(skel, false),
      });
      claimId(el, skel.id);
      if (startEl) {
        el.startBinding = { elementId: startEl.id, focus: 0, gap: 6 };
        addBoundRef(startEl, { id: el.id, type: el.type });
        touched.add(startEl.id);
      }
      if (endEl) {
        el.endBinding = { elementId: endEl.id, focus: 0, gap: 6 };
        addBoundRef(endEl, { id: el.id, type: el.type });
        touched.add(endEl.id);
      }
      routeArrow(el, startEl, endEl);
      scene.push(el);
      if (skel.label) attachLabel(scene, el, skel.label, skel.fontSize);
      continue;
    }

    if (skel.type === "frame") {
      const children = (skel.children ?? []).map((id) => {
        const child = live.get(id);
        if (!child) throw new McpToolError(`frame child "${id}" not found.`);
        return child;
      });
      let bounds = {
        x: skel.x ?? 0,
        y: skel.y ?? 0,
        width: skel.width ?? 400,
        height: skel.height ?? 300,
      };
      if (
        children.length > 0 &&
        (skel.width === undefined || skel.height === undefined)
      ) {
        const minX = Math.min(...children.map((c) => c.x));
        const minY = Math.min(...children.map((c) => c.y));
        const maxX = Math.max(...children.map((c) => c.x + c.width));
        const maxY = Math.max(...children.map((c) => c.y + c.height));
        bounds = {
          x: minX - FRAME_PADDING,
          y: minY - FRAME_PADDING,
          width: maxX - minX + FRAME_PADDING * 2,
          height: maxY - minY + FRAME_PADDING * 2,
        };
      }
      const frame = baseElement("frame", {
        ...bounds,
        name: skel.name ?? skel.label ?? null,
        strokeWidth: 2,
      });
      claimId(frame, skel.id);
      for (const child of children) {
        child.frameId = frame.id;
        touched.add(child.id);
        for (const el of scene) {
          if (el.containerId === child.id) el.frameId = frame.id;
        }
      }
      scene.push(frame);
      continue;
    }

    // rectangle | ellipse | diamond
    const size = sizeForLabel(skel.label, skel.fontSize);
    const shape = baseElement(skel.type, {
      x: skel.x ?? 0,
      y: skel.y ?? 0,
      width: skel.width ?? size.width,
      height: skel.height ?? size.height,
      roundness: ROUNDNESS[skel.type] ?? null,
      strokeStyle: skel.strokeStyle ?? "solid",
      ...colorProps(skel, true),
    });
    claimId(shape, skel.id);
    scene.push(shape);
    if (skel.label) attachLabel(scene, shape, skel.label, skel.fontSize);
  }

  const created = new Set(createdIds);
  for (const id of touched) {
    const el = live.get(id);
    if (el && !created.has(id)) bumpVersion(el);
  }
  return createdIds;
};
