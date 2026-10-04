import React, { useState } from "react";
import { Copy } from "lucide-react";
import * as api from "../../api";

type McpSnippet = {
  id: string;
  label: string;
  command: string;
  note?: string;
};

const getMcpEndpointUrl = () =>
  new URL(
    `${api.API_URL.replace(/\/$/, "")}/mcp`,
    window.location.origin,
  ).toString();

const buildMcpSnippets = (url: string, token: string): McpSnippet[] => [
  {
    id: "claude",
    label: "Claude Code",
    command: `claude mcp add --transport http excalidash ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    id: "codex",
    label: "Codex",
    command: `export EXCALIDASH_API_KEY="${token}"\ncodex mcp add excalidash --url ${url} --bearer-token-env-var EXCALIDASH_API_KEY`,
    note: 'Codex reads the token from an environment variable at startup; keep EXCALIDASH_API_KEY set in your shell profile (PowerShell: $env:EXCALIDASH_API_KEY = "...").',
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    command: `gemini mcp add --transport http --header "Authorization: Bearer ${token}" excalidash ${url}`,
  },
];

const copyText = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

export const McpSetupSnippets: React.FC<{ token: string }> = ({ token }) => {
  const snippets = buildMcpSnippets(getMcpEndpointUrl(), token);
  const [activeId, setActiveId] = useState(snippets[0].id);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const active =
    snippets.find((snippet) => snippet.id === activeId) ?? snippets[0];

  const handleCopy = async () => {
    try {
      await copyText(active.command);
      setCopiedId(active.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <div className="mt-4">
      <p className="text-sm text-amber-800 dark:text-amber-200/80 font-medium">
        Connect an AI assistant over MCP:
      </p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="tablist"
        aria-label="MCP client"
      >
        {snippets.map((snippet) => (
          <button
            key={snippet.id}
            role="tab"
            aria-selected={snippet.id === active.id}
            onClick={() => setActiveId(snippet.id)}
            className={`px-3 py-1.5 text-sm font-bold rounded-lg border-2 border-black dark:border-neutral-700 ${
              snippet.id === active.id
                ? "bg-amber-500 text-white"
                : "bg-white dark:bg-neutral-800 text-slate-700 dark:text-neutral-300"
            }`}
          >
            {snippet.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-col sm:flex-row gap-3 items-stretch">
        <pre className="flex-1 p-3 bg-white dark:bg-neutral-800 border-2 border-black dark:border-neutral-700 rounded-xl font-mono text-xs text-slate-900 dark:text-white whitespace-pre-wrap break-all">
          {active.command}
        </pre>
        <button
          onClick={() => void handleCopy()}
          aria-label={`Copy ${active.label} MCP command`}
          className="px-4 py-3 bg-amber-500 text-white font-bold rounded-xl border-2 border-black dark:border-neutral-700 flex items-center justify-center gap-2"
        >
          <Copy size={18} />
          {copiedId === active.id ? "Copied" : "Copy"}
        </button>
      </div>
      {active.note && (
        <p className="mt-2 text-xs text-amber-800 dark:text-amber-200/80 font-medium">
          {active.note}
        </p>
      )}
    </div>
  );
};
