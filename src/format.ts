import { z } from "zod";
import { CHARACTER_LIMIT } from "./constants.js";

/** Output format shared by all read tools. */
export const ResponseFormat = {
  MARKDOWN: "markdown",
  JSON: "json",
} as const;
export type ResponseFormatValue = (typeof ResponseFormat)[keyof typeof ResponseFormat];

/** Reusable Zod field: `response_format` defaulting to markdown. */
export const responseFormatSchema = z
  .enum(["markdown", "json"])
  .default("markdown")
  .describe("Output format: 'markdown' for human-readable or 'json' for machine-readable");

/** Thrown when a tool needs Google credentials but none are valid/cached. */
export class NotAuthenticatedError extends Error {
  constructor(message = "Not authenticated with Google.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/** Standard MCP tool result shape (index signature satisfies the SDK's CallToolResult). */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Build a plain text/structured success result, truncating oversized text. */
export function toolResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: truncate(text) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Build an error result with an actionable message. */
export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Pick the text representation for a read tool's response: pretty-printed JSON
 * when `format` is "json", otherwise the lazily-built markdown. The markdown
 * thunk is only invoked when needed.
 */
export function formatResponse(
  format: ResponseFormatValue,
  json: unknown,
  markdown: () => string,
): string {
  return format === ResponseFormat.JSON ? JSON.stringify(json, null, 2) : markdown();
}

/** Truncate a string to CHARACTER_LIMIT with a clear marker. */
export function truncate(text: string, limit = CHARACTER_LIMIT): string {
  if (text.length <= limit) return text;
  return (
    text.slice(0, limit) +
    `\n\n…[truncated ${text.length - limit} of ${text.length} characters. ` +
    `Narrow your query, add filters, or use pagination to see more.]`
  );
}

/** Extract an HTTP status code from a googleapis/gaxios error, if any. */
function statusOf(error: unknown): number | undefined {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const raw = e.response?.status ?? e.status ?? e.code;
    if (typeof raw === "number") return raw;
    if (typeof raw === "string" && /^\d+$/.test(raw)) return Number(raw);
  }
  return undefined;
}

/**
 * Map any thrown error into a clear, actionable message for the agent.
 * Recognizes auth failures, common HTTP statuses, and Zod validation errors.
 */
export function handleGoogleError(error: unknown): string {
  if (error instanceof NotAuthenticatedError) {
    return `Error: ${error.message} Run \`kozocom-mcp auth login\` in a terminal to sign in, then retry.`;
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    return `Error: Invalid input — ${issues}`;
  }

  const status = statusOf(error);
  const detail = error instanceof Error ? error.message : String(error);
  switch (status) {
    case 400:
      return `Error: Bad request — ${detail}. Check IDs, ranges (e.g. 'Sheet1!A1:C10'), and parameters.`;
    case 401:
      return "Error: Authentication expired or revoked. Run `kozocom-mcp auth login` to sign in again.";
    case 403:
      return `Error: Permission denied — ${detail}. You may not have access to this file, or the required API/scope is not enabled.`;
    case 404:
      return "Error: Not found. Check that the file/spreadsheet ID is correct and that you have access to it.";
    case 429:
      return "Error: Rate limit exceeded. Wait a moment and retry, or reduce the request frequency.";
    case 500:
    case 503:
      return "Error: Google API is temporarily unavailable. Please retry shortly.";
    default:
      return `Error: ${detail}`;
  }
}
