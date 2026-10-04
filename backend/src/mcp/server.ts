import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./context";
import { registerDrawingTools } from "./tools/drawings";
import { registerElementTools } from "./tools/elements";
import { registerCollectionTools } from "./tools/collections";
import { registerDiagramTools } from "./tools/diagram";

const INSTRUCTIONS = `Create and edit Excalidraw diagrams stored in ExcaliDash.

Workflow:
- New flowchart / architecture / sequence-of-steps diagram: prefer create_diagram (nodes + edges, automatic layout).
- Free-form drawing: create_drawing with skeleton elements.
- Editing: call get_drawing first to see element ids, then add_elements / update_elements / delete_elements.
- Always give the user the returned url.

Skeleton elements: {type: rectangle|ellipse|diamond|text|arrow|line|frame, id?, x, y, width?, height?, label?, text?, color?, ...}
- Shapes: "label" is centered inside; size is auto-computed from the label if width/height are omitted.
- Arrows: set start/end to element ids to connect shapes (endpoints are computed); "label" is shown on the arrow.
- color: blue, green, red, yellow, orange, violet, gray, cyan, pink, teal (stroke + light fill), or a hex strokeColor/backgroundColor.
- Coordinates are canvas pixels; y grows downward. Leave ~60-100px between shapes.
Edits appear live for users with the drawing open, merged with their own unsaved changes.`;

// A fresh server per request: the endpoint is stateless and every request
// carries its own user and API-key scopes.
export const buildMcpServer = (ctx: McpContext): McpServer => {
  const server = new McpServer(
    { name: "excalidash", version: ctx.version },
    { instructions: INSTRUCTIONS },
  );
  registerDrawingTools(server, ctx);
  registerElementTools(server, ctx);
  registerCollectionTools(server, ctx);
  registerDiagramTools(server, ctx);
  return server;
};
