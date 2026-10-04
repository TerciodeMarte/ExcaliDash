import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcrypt";
import { PrismaClient } from "../generated/client";
import { generateApiKey, serializeApiKeyScopes } from "../auth/apiKeys";
import { getTestPrisma, setupTestDb } from "./testUtils";

const createUser = async (prisma: PrismaClient, email: string) => {
  const passwordHash = await bcrypt.hash("password123", 10);
  return prisma.user.create({
    data: { email, passwordHash, name: email, role: "USER", isActive: true },
    select: { id: true },
  });
};

const createApiKey = async (
  prisma: PrismaClient,
  userId: string,
  scopes?: string[],
) => {
  const generated = generateApiKey();
  await prisma.apiKey.create({
    data: {
      userId,
      name: "mcp",
      keyId: generated.keyId,
      tokenHash: generated.tokenHash,
      prefix: generated.prefix,
      scopes: serializeApiKeyScopes(scopes),
    },
  });
  return generated.token;
};

describe("MCP endpoint", () => {
  let prisma: PrismaClient;
  let app: any;
  let token: string;
  let readOnlyToken: string;
  let otherToken: string;
  let nextId = 1;

  const rpc = (
    method: string,
    params: Record<string, unknown> = {},
    auth: string | null = token,
  ) => {
    const req = request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json");
    if (auth) req.set("Authorization", `Bearer ${auth}`);
    return req.send({ jsonrpc: "2.0", id: nextId++, method, params });
  };

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
    auth = token,
  ) => {
    const response = await rpc("tools/call", { name, arguments: args }, auth);
    expect(response.status).toBe(200);
    const result = response.body.result;
    const text = result.content[0].text as string;
    return {
      isError: Boolean(result.isError),
      text,
      data: result.isError ? null : JSON.parse(text),
    };
  };

  beforeAll(async () => {
    setupTestDb();
    prisma = getTestPrisma();
    ({ app } = await import("../index"));
    await prisma.systemConfig.upsert({
      where: { id: "default" },
      update: { authEnabled: true, registrationEnabled: false },
      create: { id: "default", authEnabled: true, registrationEnabled: false },
    });
    const user = await createUser(prisma, "mcp-user@test.local");
    const other = await createUser(prisma, "mcp-other@test.local");
    token = await createApiKey(prisma, user.id);
    readOnlyToken = await createApiKey(prisma, user.id, [
      "drawings:read",
      "collections:read",
    ]);
    otherToken = await createApiKey(prisma, other.id);
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects requests without an API key", async () => {
    // Without a bearer API key the global CSRF guard rejects the POST first.
    const response = await rpc("tools/list", {}, null);
    expect(response.status).toBe(403);
    const badKey = await rpc("tools/list", {}, "exd_invalid_invalid");
    expect(badKey.status).toBe(401);
  });

  it("answers initialize and lists tools", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "1.0.0" },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe("excalidash");

    const list = await rpc("tools/list");
    const names = list.body.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_drawings",
        "get_drawing",
        "create_drawing",
        "update_drawing",
        "add_elements",
        "update_elements",
        "delete_elements",
        "list_collections",
        "create_collection",
        "create_diagram",
      ]),
    );
  });

  it("creates, edits and reads a diagram", async () => {
    const collection = await callTool("create_collection", {
      name: "Architecture",
    });
    expect(collection.isError).toBe(false);

    const created = await callTool("create_diagram", {
      name: "Flow",
      collectionId: collection.data.id,
      direction: "LR",
      nodes: [
        { id: "api", label: "API", color: "blue" },
        { id: "db", label: "Database", shape: "ellipse" },
      ],
      edges: [{ from: "api", to: "db", label: "SQL" }],
    });
    expect(created.isError).toBe(false);
    expect(created.data.url).toMatch(/\/editor\//);
    const drawingId = created.data.id as string;

    const stored = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawingId },
    });
    const elements = JSON.parse(stored.elements);
    const arrow = elements.find((el: any) => el.type === "arrow");
    expect(arrow.startBinding.elementId).toBe("api");
    expect(arrow.endBinding.elementId).toBe("db");
    expect(stored.collectionId).toBe(collection.data.id);

    const added = await callTool("add_elements", {
      drawingId,
      elements: [
        { type: "rectangle", id: "cache", x: 0, y: 300, label: "Cache" },
        { type: "arrow", start: "api", end: "cache" },
      ],
    });
    expect(added.isError).toBe(false);
    expect(added.data.version).toBe(stored.version + 1);

    const apiBefore = elements.find((el: any) => el.id === "api");
    const moved = await callTool("update_elements", {
      drawingId,
      updates: [{ id: "api", x: apiBefore.x - 200, label: "Gateway" }],
    });
    expect(moved.isError).toBe(false);

    const deleted = await callTool("delete_elements", {
      drawingId,
      ids: ["cache"],
    });
    expect(deleted.data.deletedElementIds).toContain("cache");

    // Editors re-key (and version-bump) elements without ordered indices,
    // which would tie with the next MCP edit; every write must leave them set.
    const afterEdits = await prisma.drawing.findUniqueOrThrow({
      where: { id: drawingId },
    });
    const indices = JSON.parse(afterEdits.elements).map((el: any) => el.index);
    expect(indices.every((index: unknown) => typeof index === "string")).toBe(
      true,
    );
    expect([...indices].sort()).toEqual(indices);
    expect(new Set(indices).size).toBe(indices.length);

    const read = await callTool("get_drawing", { id: drawingId });
    const summary = read.data.elements as any[];
    expect(summary.find((el) => el.id === "api").label).toBe("Gateway");
    expect(summary.some((el) => el.id === "cache")).toBe(false);
    const orphanArrow = summary.find((el) => el.type === "arrow" && !el.end);
    expect(orphanArrow?.start).toBe("api");

    const listed = await callTool("list_drawings", {
      collectionId: collection.data.id,
    });
    expect(listed.data.drawings.map((d: any) => d.id)).toContain(drawingId);
  });

  it("enforces API key scopes per tool", async () => {
    const result = await callTool(
      "create_drawing",
      { name: "Nope" },
      readOnlyToken,
    );
    expect(result.isError).toBe(true);
    expect(result.text).toContain("drawings:write");

    const list = await callTool("list_drawings", {}, readOnlyToken);
    expect(list.isError).toBe(false);
  });

  it("hides drawings the caller cannot access", async () => {
    const mine = await callTool("create_drawing", {
      name: "Private",
      elements: [{ type: "text", x: 0, y: 0, text: "secret" }],
    });
    const result = await callTool(
      "get_drawing",
      { id: mine.data.id },
      otherToken,
    );
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found/i);
  });

  it("reports invalid element references as tool errors", async () => {
    const result = await callTool("create_drawing", {
      name: "Broken",
      elements: [{ type: "arrow", start: "missing" }],
    });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("missing");
  });

  it("pushes edits to open editors as a persisted scene, not a reload", async () => {
    const { notifyDrawingChanged } = await import("../mcp/drawingStore");
    const emitted: Array<{ room: string; event: string; payload: any }> = [];
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          emitted.push({ room, event, payload });
        },
      }),
    };
    const elements = [
      { id: "a", type: "rectangle", version: 3 },
      { id: "b", type: "text", version: 2, isDeleted: true },
    ];
    notifyDrawingChanged({ io } as any, "d1", elements as any);
    expect(emitted).toEqual([
      {
        room: "drawing_d1",
        event: "element-update",
        payload: {
          drawingId: "d1",
          persisted: true,
          elements,
          elementOrder: ["a", "b"],
        },
      },
    ]);
  });
});
