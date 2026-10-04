import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpDeps } from "./context";
import { buildMcpServer } from "./server";

type RegisterMcpRoutesDeps = McpDeps & {
  requireAuth: express.RequestHandler;
};

const jsonRpcError = (res: express.Response, status: number, message: string) =>
  res
    .status(status)
    .json({ jsonrpc: "2.0", error: { code: -32000, message }, id: null });

/**
 * Model Context Protocol endpoint (Streamable HTTP, stateless, JSON responses).
 * Clients authenticate with an ExcaliDash API key: `Authorization: Bearer exd_...`.
 * Tool calls are further limited by the key's scopes and by drawing access.
 */
export const registerMcpRoutes = (
  app: express.Express,
  deps: RegisterMcpRoutesDeps,
) => {
  const { requireAuth, ...mcpDeps } = deps;

  app.post("/mcp", requireAuth, async (req, res) => {
    const user = req.user;
    if (!user) return jsonRpcError(res, 401, "Unauthorized");
    // Browser sessions (cookie/JWT) are not accepted: MCP clients use API keys.
    if (
      user.authCredentialType !== "apiKey" &&
      user.authCredentialType !== "bootstrap"
    ) {
      return jsonRpcError(
        res,
        401,
        "The MCP endpoint requires an API key (Authorization: Bearer exd_...).",
      );
    }

    const server = buildMcpServer({
      ...mcpDeps,
      userId: user.id,
      scopes:
        user.authCredentialType === "apiKey"
          ? new Set(user.apiKeyScopes ?? [])
          : null,
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] request failed:", error);
      if (!res.headersSent) jsonRpcError(res, 500, "Internal server error");
    }
  });

  // Stateless server: no SSE stream to resume and no session to delete.
  const methodNotAllowed: express.RequestHandler = (_req, res) => {
    res.setHeader("Allow", "POST");
    jsonRpcError(res, 405, "Method not allowed.");
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
};
