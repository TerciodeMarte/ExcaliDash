import crypto from "crypto";

export type ExcalidrawElement = Record<string, any> & {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const FONT_SIZE = 20;
export const LINE_HEIGHT = 1.25;
// Excalifont, the default hand-drawn font in Excalidraw 0.18.
export const FONT_FAMILY = 5;
const CHAR_WIDTH_RATIO = 0.6;
const CONTAINER_PADDING = 24;
const ARROW_GAP = 6;

export const NAMED_COLORS: Record<string, { stroke: string; fill: string }> = {
  blue: { stroke: "#1971c2", fill: "#a5d8ff" },
  green: { stroke: "#2f9e44", fill: "#b2f2bb" },
  red: { stroke: "#e03131", fill: "#ffc9c9" },
  yellow: { stroke: "#f08c00", fill: "#ffec99" },
  orange: { stroke: "#e8590c", fill: "#ffd8a8" },
  violet: { stroke: "#6741d9", fill: "#d0bfff" },
  gray: { stroke: "#495057", fill: "#e9ecef" },
  cyan: { stroke: "#0c8599", fill: "#99e9f2" },
  pink: { stroke: "#c2255c", fill: "#fcc2d7" },
  teal: { stroke: "#099268", fill: "#96f2d7" },
};

export const COLOR_NAMES = Object.keys(NAMED_COLORS) as [string, ...string[]];

export const randomId = (): string =>
  crypto.randomBytes(12).toString("base64url");
export const randomInt = (): number => crypto.randomInt(1, 2 ** 31 - 1);

export const measureText = (text: string, fontSize = FONT_SIZE) => {
  const lines = text.split("\n");
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    width: Math.max(1, Math.ceil(longest * fontSize * CHAR_WIDTH_RATIO)),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
};

// Size of a shape large enough to hold `label` with padding.
export const sizeForLabel = (
  label: string | undefined,
  fontSize = FONT_SIZE,
) => {
  if (!label) return { width: 160, height: 80 };
  const text = measureText(label, fontSize);
  return {
    width: Math.max(120, text.width + CONTAINER_PADDING * 2),
    height: Math.max(60, text.height + CONTAINER_PADDING * 2),
  };
};

export const baseElement = (
  type: string,
  props: Partial<ExcalidrawElement> & { x: number; y: number },
): ExcalidrawElement => ({
  id: randomId(),
  type,
  width: 0,
  height: 0,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  index: null,
  roundness: null,
  seed: randomInt(),
  version: 1,
  versionNonce: randomInt(),
  isDeleted: false,
  boundElements: null,
  updated: Date.now(),
  link: null,
  locked: false,
  ...props,
});

// Mark an element as changed so collaborating clients reconcile to it.
export const bumpVersion = (element: ExcalidrawElement): ExcalidrawElement => {
  element.version =
    (typeof element.version === "number" ? element.version : 0) + 1;
  element.versionNonce = randomInt();
  element.updated = Date.now();
  return element;
};

export const center = (el: ExcalidrawElement) => ({
  x: el.x + el.width / 2,
  y: el.y + el.height / 2,
});

// Point on the outline of `el` in the direction of `toward`, pushed out by a gap.
export const boundaryPoint = (
  el: ExcalidrawElement,
  toward: { x: number; y: number },
): { x: number; y: number } => {
  const c = center(el);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const a = Math.max(el.width / 2, 1);
  const b = Math.max(el.height / 2, 1);
  let t: number;
  if (el.type === "ellipse") {
    t = 1 / Math.sqrt((dx / a) ** 2 + (dy / b) ** 2);
  } else if (el.type === "diamond") {
    t = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
  } else {
    t = Math.min(
      dx !== 0 ? a / Math.abs(dx) : Infinity,
      dy !== 0 ? b / Math.abs(dy) : Infinity,
    );
  }
  const len = Math.sqrt(dx * dx + dy * dy);
  const gap = ARROW_GAP / len;
  return { x: c.x + dx * (t + gap), y: c.y + dy * (t + gap) };
};

// Recompute an arrow's position/points so it connects its bound elements.
export const routeArrow = (
  arrow: ExcalidrawElement,
  start: ExcalidrawElement | undefined,
  end: ExcalidrawElement | undefined,
): void => {
  const points: [number, number][] =
    Array.isArray(arrow.points) && arrow.points.length >= 2
      ? arrow.points
      : [
          [0, 0],
          [arrow.width || 100, arrow.height || 0],
        ];
  const last = points[points.length - 1];
  let from = { x: arrow.x, y: arrow.y };
  let to = { x: arrow.x + last[0], y: arrow.y + last[1] };
  if (start) from = boundaryPoint(start, end ? center(end) : to);
  if (end) to = boundaryPoint(end, start ? center(start) : from);
  arrow.x = from.x;
  arrow.y = from.y;
  arrow.points = [
    [0, 0],
    [to.x - from.x, to.y - from.y],
  ];
  arrow.width = Math.abs(to.x - from.x);
  arrow.height = Math.abs(to.y - from.y);
};

// Center a bound text element inside its container (or on an arrow's midpoint).
export const placeBoundText = (
  text: ExcalidrawElement,
  container: ExcalidrawElement,
): void => {
  if (container.type === "arrow" || container.type === "line") {
    const last = container.points?.[container.points.length - 1] ?? [0, 0];
    text.x = container.x + last[0] / 2 - text.width / 2;
    text.y = container.y + last[1] / 2 - text.height / 2;
    return;
  }
  const c = center(container);
  text.x = c.x - text.width / 2;
  text.y = c.y - text.height / 2;
};
