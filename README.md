# kozocom-mcp

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server built with
`@modelcontextprotocol/sdk`, Zod, TypeScript, and oxlint.

## Setup

```bash
pnpm install
```

## Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `pnpm dev`        | Run the server with hot reload (`tsx watch`) |
| `pnpm build`      | Compile TypeScript to `dist/`                |
| `pnpm start`      | Run the compiled server (`dist/index.js`)    |
| `pnpm lint`       | Lint with oxlint                             |
| `pnpm typecheck`  | Type-check without emitting                  |

## Adding a tool

Tools are registered in `src/index.ts` via `server.registerTool`. Input is validated
with Zod. The included `ping` tool is a template — replace it with your own.

## Using with an MCP client

After `pnpm build`, point your MCP client at the built server:

```json
{
  "mcpServers": {
    "kozocom": {
      "command": "node",
      "args": ["/home/quang/Projects/kozocom/kozocom-mcp/dist/index.js"]
    }
  }
}
```
