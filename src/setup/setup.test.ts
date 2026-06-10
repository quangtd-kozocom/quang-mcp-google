import { describe, expect, it } from "vitest";
import { configReport, mcpConfigSnippet, parseClient } from "./setup.js";
import { DANGEROUS_TOOL_NAMES, READ_ONLY_TOOL_NAMES } from "../services/registry.js";

describe("parseClient", () => {
  it("accepts known clients", () => {
    expect(parseClient("codex")).toBe("codex");
    expect(parseClient("kiro")).toBe("kiro");
    expect(parseClient("all")).toBe("all");
    expect(parseClient(undefined)).toBeUndefined();
  });

  it("rejects unknown clients", () => {
    expect(() => parseClient("unknown")).toThrow(
      'Unknown client "unknown". Use codex, claude, copilot, kiro, or all.',
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
    ).toContain('args = ["-y","--package=terra-mcp-google","terra-mcp"]');
  });

  it("builds VS Code Copilot JSON", () => {
    const snippet = mcpConfigSnippet({
      client: "copilot",
      credentialsPath: "/tmp/client_secret.json",
    });

    expect(JSON.parse(snippet.split("\n\n")[1] ?? "")).toEqual({
      servers: {
        "terra-mcp-google": {
          type: "stdio",
          command: "npx",
          args: ["-y", "--package=terra-mcp-google", "terra-mcp"],
          env: { GOOGLE_OAUTH_CREDENTIALS: "/tmp/client_secret.json" },
        },
      },
    });
  });

  it("omits the credentials env by default for embedded-client packages", () => {
    const snippet = mcpConfigSnippet({ client: "codex" });
    expect(snippet).not.toContain("GOOGLE_OAUTH_CREDENTIALS");
  });

  it("omits tool-gating when not in safe mode", () => {
    const snippet = mcpConfigSnippet({ client: "all", credentialsPath: "/tmp/cs.json" });
    expect(snippet).not.toContain("disabled_tools");
    expect(snippet).not.toContain("enabled_tools");
  });

  it("emits Codex enabled_tools / disabled_tools in safe mode", () => {
    const snippet = mcpConfigSnippet({ client: "codex", credentialsPath: "/tmp/cs.json", safeMode: true });
    for (const name of READ_ONLY_TOOL_NAMES) {
      expect(snippet).toContain(`enabled_tools`);
      expect(snippet).toContain(`"${name}"`);
    }
    expect(snippet).toContain("disabled_tools");
    for (const name of DANGEROUS_TOOL_NAMES) {
      expect(snippet).toContain(`"${name}"`);
    }
  });

  it("uses --package= (not -p) so Claude's CLI doesn't steal it as --print", () => {
    const snippet = mcpConfigSnippet({ client: "claude" });
    expect(snippet).toContain("claude mcp add terra-mcp-google -- 'npx' '-y' '--package=terra-mcp-google' 'terra-mcp'");
    expect(snippet).not.toMatch(/ '-p' /);
  });

  it("emits a Claude permission deny list in safe mode", () => {
    const snippet = mcpConfigSnippet({ client: "claude", credentialsPath: "/tmp/cs.json", safeMode: true });
    expect(snippet).toContain("permissions");
    for (const name of DANGEROUS_TOOL_NAMES) {
      expect(snippet).toContain(`mcp__terra-mcp-google__${name}`);
    }
  });

  it("builds Kiro mcp.json with the mcpServers wrapper", () => {
    const snippet = mcpConfigSnippet({ client: "kiro", credentialsPath: "/tmp/cs.json" });
    const json = JSON.parse(snippet.split("\n\n")[1] ?? "");
    expect(json.mcpServers["terra-mcp-google"]).toEqual({
      command: "npx",
      args: ["-y", "--package=terra-mcp-google", "terra-mcp"],
      env: { GOOGLE_OAUTH_CREDENTIALS: "/tmp/cs.json" },
      disabled: false,
      autoApprove: [],
    });
  });

  it("auto-approves only the read-only tools for Kiro in safe mode", () => {
    const snippet = mcpConfigSnippet({ client: "kiro", credentialsPath: "/tmp/cs.json", safeMode: true });
    const json = JSON.parse(snippet.split("\n\n")[1] ?? "");
    expect(json.mcpServers["terra-mcp-google"].autoApprove).toEqual([...READ_ONLY_TOOL_NAMES]);
  });

  it("names the read-only tool set for Copilot in safe mode", () => {
    const snippet = mcpConfigSnippet({ client: "copilot", credentialsPath: "/tmp/cs.json", safeMode: true });
    const json = JSON.parse(snippet.split("\n\n")[1] ?? "");
    expect(json.servers["terra-mcp-google"].tools).toEqual([...READ_ONLY_TOOL_NAMES]);
  });
});

describe("danger classification", () => {
  it("treats only read-only tools as enabled", () => {
    expect(new Set(READ_ONLY_TOOL_NAMES)).toEqual(
      new Set([
        "google_auth_status",
        "drive_list_files",
        "drive_get_file",
        "sheets_get_spreadsheet",
        "sheets_read_range",
      ]),
    );
  });

  it("treats every mutating tool as dangerous", () => {
    expect(new Set(DANGEROUS_TOOL_NAMES)).toEqual(
      new Set([
        "drive_create_folder",
        "drive_download_file",
        "drive_upload_file",
        "drive_update_file",
        "drive_copy_file",
        "drive_delete_file",
        "sheets_create_spreadsheet",
        "sheets_write_range",
        "sheets_append_rows",
        "sheets_clear_range",
        "sheets_add_sheet",
        "sheets_delete_sheet",
        "sheets_format_cells",
        "sheets_set_data_validation",
        "sheets_batch_update",
      ]),
    );
  });
});

describe("configReport", () => {
  it("lists enabled and disabled tools in safe mode", () => {
    const report = configReport({ client: "claude" });
    expect(report).toContain("Enabled (read-only) tools:");
    expect(report).toContain("Disabled (dangerous) tools:");
    for (const name of [...READ_ONLY_TOOL_NAMES, ...DANGEROUS_TOOL_NAMES]) {
      expect(report).toContain(name);
    }
  });

  it("omits the tool note when dangerous tools are kept", () => {
    const report = configReport({ client: "claude", safeMode: false });
    expect(report).not.toContain("Disabled (dangerous) tools:");
  });
});
