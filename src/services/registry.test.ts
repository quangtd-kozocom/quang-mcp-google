import { describe, expect, it } from "vitest";
import { DANGEROUS_TOOL_NAMES, googleTools, READ_ONLY_TOOL_NAMES, selectGoogleTools } from "./registry.js";
import { isReadOnlyTool } from "../core/tool.js";

describe("selectGoogleTools", () => {
  it("returns every tool when not in safe mode", () => {
    expect(selectGoogleTools(false)).toEqual(googleTools);
  });

  it("keeps only read-only tools in safe mode", () => {
    const safe = selectGoogleTools(true);
    expect(safe.length).toBe(READ_ONLY_TOOL_NAMES.length);
    expect(safe.every(isReadOnlyTool)).toBe(true);
    const names = safe.map((t) => t.toolName);
    for (const dangerous of DANGEROUS_TOOL_NAMES) {
      expect(names).not.toContain(dangerous);
    }
  });

  it("partitions tools by the readOnly annotation", () => {
    expect(READ_ONLY_TOOL_NAMES.length + DANGEROUS_TOOL_NAMES.length).toBe(googleTools.length);
    for (const tool of googleTools) {
      expect(isReadOnlyTool(tool)).toBe(tool.annotations.readOnlyHint === true);
    }
  });
});
