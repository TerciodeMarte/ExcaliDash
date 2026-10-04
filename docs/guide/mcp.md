---
title: ExcaliDash MCP Server
description: Connect AI assistants such as Claude Code, Codex, and Gemini CLI to ExcaliDash through the Model Context Protocol.
---

# AI assistants (MCP)

The backend exposes a [Model Context Protocol](https://modelcontextprotocol.io) endpoint at `/api/mcp` (Streamable HTTP). Create an API key in your profile, then connect a client:

```sh
# Claude Code
claude mcp add --transport http excalidash https://YOUR_HOST/api/mcp --header "Authorization: Bearer exd_..."
# Codex (reads the token from an environment variable)
export EXCALIDASH_API_KEY="exd_..."
codex mcp add excalidash --url https://YOUR_HOST/api/mcp --bearer-token-env-var EXCALIDASH_API_KEY
# Gemini CLI
gemini mcp add --transport http --header "Authorization: Bearer exd_..." excalidash https://YOUR_HOST/api/mcp
```

The API key dialog shows these commands pre-filled with the new token.

Tools: `list_drawings`, `get_drawing`, `create_drawing`, `update_drawing`, `create_diagram` (auto-layout), `add_elements`, `update_elements`, `delete_elements`, `list_collections`, `create_collection`. Tool calls respect the key's scopes and drawing sharing.

Disable the endpoint with `MCP_ENABLED=false`.
