import type { Server as SocketIoServer } from "socket.io";
import { ZodError } from "zod";
import type { Prisma, PrismaClient } from "../generated/client";
import { DrawingSanitizationError } from "../security";

export type McpDeps = {
  prisma: PrismaClient;
  io?: SocketIoServer;
  parseJsonField: <T>(rawValue: string | null | undefined, fallback: T) => T;
  invalidateDrawingsCache: (userId?: string) => void;
  ensureTrashCollection: (
    db: Prisma.TransactionClient | PrismaClient,
    userId: string,
  ) => Promise<void>;
  sanitizeText: (input: unknown, maxLength?: number) => string;
  // Public origin of the frontend, used to build links returned to the client.
  publicBaseUrl: string;
  version: string;
};

export type McpContext = McpDeps & {
  userId: string;
  // `null` means unrestricted (AUTH_MODE=disabled bootstrap user).
  scopes: ReadonlySet<string> | null;
};

export type McpScope =
  "drawings:read" | "drawings:write" | "collections:read" | "collections:write";

// Errors whose message is safe and useful to show to the MCP client.
export class McpToolError extends Error {}

export const requireScope = (ctx: McpContext, scope: McpScope): void => {
  if (ctx.scopes && !ctx.scopes.has(scope)) {
    throw new McpToolError(`This API key is missing the "${scope}" scope.`);
  }
};

export const drawingUrl = (ctx: McpContext, drawingId: string): string =>
  `${ctx.publicBaseUrl}/editor/${drawingId}`;

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

const textResult = (text: string, isError = false): ToolResult =>
  isError
    ? { content: [{ type: "text", text }], isError }
    : { content: [{ type: "text", text }] };

// Wraps a tool body: serializes its return value as JSON text and turns
// expected failures into MCP tool errors without leaking internals.
export const runTool =
  <A>(fn: (args: A) => Promise<unknown>) =>
  async (args: A): Promise<ToolResult> => {
    try {
      const payload = await fn(args);
      return textResult(JSON.stringify(payload, null, 2));
    } catch (error) {
      if (
        error instanceof McpToolError ||
        error instanceof DrawingSanitizationError
      ) {
        return textResult(error.message, true);
      }
      if (error instanceof ZodError) {
        const issues = error.issues
          .map(
            (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("; ");
        return textResult(`Invalid input: ${issues}`, true);
      }
      console.error("[mcp] tool failed:", error);
      return textResult("Internal error while running the tool.", true);
    }
  };
