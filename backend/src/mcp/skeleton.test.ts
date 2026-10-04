import { describe, expect, it } from "vitest";
import { addSkeletons } from "./skeleton";
import { applyPatches, deleteElements, summarizeScene } from "./sceneEdits";
import { layoutDiagram } from "./layout";
import { elementSchema } from "../security";
import type { ExcalidrawElement } from "./geometry";

const byId = (scene: ExcalidrawElement[], id: string) =>
  scene.find((el) => el.id === id)!;

describe("addSkeletons", () => {
  it("creates labelled shapes with bound text right after the container", () => {
    const scene: ExcalidrawElement[] = [];
    addSkeletons(scene, [
      {
        type: "rectangle",
        id: "a",
        x: 10,
        y: 20,
        label: "Hello",
        color: "blue",
      },
    ]);
    expect(scene).toHaveLength(2);
    const [rect, text] = scene;
    expect(rect.backgroundColor).toBe("#a5d8ff");
    expect(text.containerId).toBe("a");
    expect(rect.boundElements).toEqual([{ id: text.id, type: "text" }]);
    expect(text.x + text.width / 2).toBeCloseTo(rect.x + rect.width / 2);
    expect(() => elementSchema.array().parse(scene)).not.toThrow();
  });

  it("binds arrows to shapes and routes them between outlines", () => {
    const scene: ExcalidrawElement[] = [];
    addSkeletons(scene, [
      { type: "arrow", id: "link", start: "a", end: "b" },
      { type: "rectangle", id: "a", x: 0, y: 0, width: 100, height: 50 },
      { type: "rectangle", id: "b", x: 300, y: 0, width: 100, height: 50 },
    ]);
    const arrow = byId(scene, "link");
    expect(arrow.startBinding.elementId).toBe("a");
    expect(arrow.endBinding.elementId).toBe("b");
    expect(arrow.x).toBeGreaterThan(100);
    expect(arrow.x + arrow.points[1][0]).toBeLessThan(300);
    expect(byId(scene, "a").boundElements).toEqual([
      { id: "link", type: "arrow" },
    ]);
  });

  it("rejects duplicate ids and unknown references", () => {
    const scene: ExcalidrawElement[] = [];
    addSkeletons(scene, [{ type: "ellipse", id: "a", x: 0, y: 0 }]);
    expect(() =>
      addSkeletons(scene, [{ type: "diamond", id: "a", x: 0, y: 0 }]),
    ).toThrow(/already exists/);
    expect(() => addSkeletons(scene, [{ type: "arrow", end: "nope" }])).toThrow(
      /nope/,
    );
  });

  it("wraps frame children and sizes the frame around them", () => {
    const scene: ExcalidrawElement[] = [];
    addSkeletons(scene, [
      { type: "rectangle", id: "a", x: 100, y: 100, width: 100, height: 100 },
      { type: "frame", id: "f", name: "Group", children: ["a"] },
    ]);
    const frame = byId(scene, "f");
    expect(byId(scene, "a").frameId).toBe("f");
    expect(frame.x).toBeLessThan(100);
    expect(frame.width).toBeGreaterThan(100);
  });
});

describe("scene edits", () => {
  const build = () => {
    const scene: ExcalidrawElement[] = [];
    addSkeletons(scene, [
      { type: "rectangle", id: "a", x: 0, y: 0, label: "A" },
      { type: "rectangle", id: "b", x: 400, y: 0, label: "B" },
      { type: "arrow", id: "ab", start: "a", end: "b", label: "calls" },
    ]);
    return scene;
  };

  it("moves shapes with their labels and re-routes bound arrows", () => {
    const scene = build();
    const arrowBefore = { ...byId(scene, "ab") };
    const versionBefore = byId(scene, "a").version;
    applyPatches(scene, [{ id: "a", y: 300, label: "Renamed" }]);
    const label = scene.find((el) => el.containerId === "a")!;
    expect(label.text).toBe("Renamed");
    expect(label.y).toBeGreaterThan(300);
    expect(byId(scene, "ab").y).not.toBe(arrowBefore.y);
    expect(byId(scene, "a").version).toBe(versionBefore + 1);
  });

  it("deletes labels with their container and unbinds arrows", () => {
    const scene = build();
    const deleted = deleteElements(scene, ["b"]);
    expect(deleted).toHaveLength(2);
    expect(byId(scene, "ab").endBinding).toBeNull();
    const summary = summarizeScene(scene);
    expect(summary.map((el) => el.id)).toEqual(["a", "ab"]);
    expect(summary.find((el) => el.id === "ab")).toMatchObject({
      start: "a",
      label: "calls",
    });
  });
});

describe("layoutDiagram", () => {
  it("ranks nodes along the requested direction", () => {
    const skeletons = layoutDiagram(
      [
        { id: "a", label: "Start" },
        { id: "b", label: "End" },
      ],
      [{ from: "a", to: "b" }],
      "LR",
    );
    const [a, b] = skeletons;
    expect(b.x!).toBeGreaterThan(a.x! + a.width!);
    expect(skeletons[2]).toMatchObject({ type: "arrow", start: "a", end: "b" });
  });
});
