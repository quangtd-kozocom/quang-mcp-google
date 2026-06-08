import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { drive_v3, sheets_v4 } from "googleapis";
import { errorResult, handleGoogleError, type ToolResult } from "../format.js";
import { getGoogleClients } from "../google.js";

/**
 * Args a handler receives: the parsed output of its Zod input shape, with
 * defaults applied. Derived from the schema so the schema is the single source
 * of truth — handlers never re-declare their argument types by hand.
 */
export type ArgsOf<Shape extends z.ZodRawShape> = z.infer<z.ZodObject<Shape>>;

/**
 * A self-registering tool. Defining a tool yields one of these; the registry
 * just calls it with the server. Capturing registration in a closure (rather
 * than an erased `{ definition, handler }` record) is what lets each tool stay
 * fully type-checked against its own schema.
 */
export type ToolRegistration = (server: McpServer) => void;

interface ToolSpec<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  annotations: ToolAnnotations;
}

/** Register a tool whose handler is `run`, mapping any thrown error to a result. */
function register<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape>,
  run: (args: ArgsOf<Shape>) => Promise<ToolResult>,
): ToolRegistration {
  const { name, title, description, inputSchema, annotations } = spec;
  const callback = async (args: ArgsOf<Shape>): Promise<ToolResult> => {
    try {
      return await run(args);
    } catch (error) {
      return errorResult(handleGoogleError(error));
    }
  };
  return (server) => {
    // The SDK's callback type is generic over its own zod-compat shapes and a
    // wider CallToolResult content union than ToolResult. `callback` is fully
    // checked against `Shape` above; this single cast bridges that boundary —
    // the only erasure in the registration path.
    server.registerTool(
      name,
      { title, description, inputSchema, annotations },
      callback as unknown as ToolCallback<Shape>,
    );
  };
}

/**
 * Define a tool that needs no Google client (e.g. auth tools). The handler owns
 * its own error handling when it must shape errors specially; otherwise thrown
 * errors are caught and returned via {@link handleGoogleError}.
 */
export function tool<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape> & { run: (args: ArgsOf<Shape>) => Promise<ToolResult> },
): ToolRegistration {
  return register(spec, spec.run);
}

/**
 * Define a Drive tool. The authorized Drive client is fetched and injected per
 * call; `NotAuthenticated`/API errors are mapped to actionable results. The
 * pure `run` function is what unit tests call directly with a fake client.
 */
export function driveTool<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape> & {
    run: (drive: drive_v3.Drive, args: ArgsOf<Shape>) => Promise<ToolResult>;
  },
): ToolRegistration {
  return register(spec, async (args) => {
    const { drive } = await getGoogleClients();
    return spec.run(drive, args);
  });
}

/** Define a Sheets tool. See {@link driveTool}; injects the Sheets client. */
export function sheetsTool<Shape extends z.ZodRawShape>(
  spec: ToolSpec<Shape> & {
    run: (sheets: sheets_v4.Sheets, args: ArgsOf<Shape>) => Promise<ToolResult>;
  },
): ToolRegistration {
  return register(spec, async (args) => {
    const { sheets } = await getGoogleClients();
    return spec.run(sheets, args);
  });
}

/** Register every tool in the list with the server. */
export function registerAll(server: McpServer, tools: readonly ToolRegistration[]): void {
  for (const registerTool of tools) registerTool(server);
}
