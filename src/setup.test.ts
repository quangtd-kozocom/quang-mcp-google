import { describe, expect, it } from "vitest";
import { mcpConfigSnippet, parseSetupArgs } from "./setup.js";

describe("parseSetupArgs", () => {
  it("parses setup options", () => {
    expect(parseSetupArgs(["--client", "codex", "--no-login", "--yes"])).toEqual({
      client: "codex",
      login: false,
      yes: true,
    });
  });

  it("rejects unknown clients", () => {
    expect(() => parseSetupArgs(["--client", "unknown"])).toThrow(
      'Unknown client "unknown". Use codex, claude, copilot, or all.',
    );
  });
});

describe("mcpConfigSnippet", () => {
  it("builds a Codex config for npx usage", () => {
    expect(
      mcpConfigSnippet({
        client: "codex",
        credentialsPath: "/tmp/client_secret.json",
      }),
    ).toContain('args = ["-y","kozocom-mcp-google"]');
  });

  it("builds VS Code Copilot JSON", () => {
    const snippet = mcpConfigSnippet({
      client: "copilot",
      credentialsPath: "/tmp/client_secret.json",
    });

    expect(JSON.parse(snippet.split("\n\n")[1] ?? "")).toEqual({
      servers: {
        "kozocom-google": {
          type: "stdio",
          command: "npx",
          args: ["-y", "kozocom-mcp-google"],
          env: { GOOGLE_OAUTH_CREDENTIALS: "/tmp/client_secret.json" },
        },
      },
    });
  });
});
