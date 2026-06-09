import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  errorResult,
  handleGoogleError,
  NotAuthenticatedError,
  toolResult,
  truncate,
} from "./result.js";

describe("toolResult / errorResult", () => {
  it("wraps text and structured content", () => {
    const r = toolResult("hello", { a: 1 });
    expect(r.content).toEqual([{ type: "text", text: "hello" }]);
    expect(r.structuredContent).toEqual({ a: 1 });
    expect(r.isError).toBeUndefined();
  });

  it("omits structuredContent when not provided", () => {
    const r = toolResult("hi");
    expect(r.structuredContent).toBeUndefined();
  });

  it("marks errors", () => {
    const r = errorResult("boom");
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toBe("boom");
  });
});

describe("truncate", () => {
  it("leaves short text untouched", () => {
    expect(truncate("abc", 10)).toBe("abc");
  });

  it("truncates and annotates long text", () => {
    const out = truncate("abcdef", 3);
    expect(out.startsWith("abc")).toBe(true);
    expect(out).toContain("truncated");
  });
});

describe("handleGoogleError", () => {
  it("guides to login for NotAuthenticatedError", () => {
    const msg = handleGoogleError(new NotAuthenticatedError("No saved Google credentials."));
    expect(msg).toContain("auth login");
  });

  it("formats Zod validation errors", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = handleGoogleError(result.error);
      expect(msg).toContain("Invalid input");
      expect(msg).toContain("name");
    }
  });

  it.each([
    [400, "Bad request"],
    [401, "sign in again"],
    [403, "Permission denied"],
    [404, "Not found"],
    [429, "Rate limit"],
    [500, "temporarily unavailable"],
    [503, "temporarily unavailable"],
  ])("maps HTTP %s", (status, fragment) => {
    const msg = handleGoogleError({ response: { status }, message: "x" });
    expect(msg).toContain(fragment);
  });

  it("disambiguates 404 between missing and no-access, and includes detail", () => {
    const msg = handleGoogleError({ response: { status: 404 }, message: "File not found: abc" });
    expect(msg).toContain("does not exist");
    expect(msg).toContain("lack access");
    expect(msg).toContain("File not found: abc");
  });

  it("reads status from gaxios .code", () => {
    expect(handleGoogleError({ code: 404 })).toContain("Not found");
  });

  it("falls back to the error message", () => {
    expect(handleGoogleError(new Error("weird failure"))).toContain("weird failure");
  });
});
