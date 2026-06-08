import { beforeEach, describe, expect, it, vi } from "vitest";
import type { sheets_v4 } from "googleapis";

vi.mock("../google.js", () => ({ getGoogleClients: vi.fn() }));

import {
  sheetsAddSheet,
  sheetsCreateSpreadsheet,
  sheetsDeleteSheet,
  sheetsGetSpreadsheet,
  sheetsReadRange,
  sheetsWriteRange,
} from "./sheets.js";

function fakeSheets() {
  return {
    spreadsheets: {
      create: vi.fn(),
      get: vi.fn(),
      batchUpdate: vi.fn(),
      values: {
        get: vi.fn(),
        batchGet: vi.fn(),
        update: vi.fn(),
        append: vi.fn(),
        clear: vi.fn(),
      },
    },
  };
}

/** Cast a fake to the Sheets type for passing into handlers. */
const asSheets = (s: ReturnType<typeof fakeSheets>): sheets_v4.Sheets =>
  s as unknown as sheets_v4.Sheets;

beforeEach(() => vi.clearAllMocks());

describe("sheetsCreateSpreadsheet", () => {
  it("returns id, title, and a docs URL", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.create.mockResolvedValue({
      data: { spreadsheetId: "abc", properties: { title: "Budget" } },
    });
    const res = await sheetsCreateSpreadsheet(asSheets(sheets), { title: "Budget", sheet_titles: ["Q1"] });
    expect(sheets.spreadsheets.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          properties: { title: "Budget" },
          sheets: [{ properties: { title: "Q1" } }],
        }),
      }),
    );
    expect(res.structuredContent).toMatchObject({
      spreadsheet_id: "abc",
      url: "https://docs.google.com/spreadsheets/d/abc/edit",
    });
  });
});

describe("sheetsGetSpreadsheet", () => {
  it("summarizes tabs", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.get.mockResolvedValue({
      data: {
        spreadsheetId: "s1",
        properties: { title: "T" },
        sheets: [
          { properties: { sheetId: 0, title: "Sheet1", index: 0, gridProperties: { rowCount: 100, columnCount: 26 } } },
        ],
      },
    });
    const res = await sheetsGetSpreadsheet(asSheets(sheets), { spreadsheet_id: "s1", response_format: "markdown" });
    expect(res.content[0].text).toContain("Sheet1");
    expect(res.structuredContent).toMatchObject({ sheets: [{ title: "Sheet1", rows: 100 }] });
  });
});

describe("sheetsReadRange", () => {
  it("returns values and a markdown table", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.get.mockResolvedValue({
      data: { range: "Sheet1!A1:B2", values: [["h1", "h2"], ["a", "b"]] },
    });
    const res = await sheetsReadRange(asSheets(sheets), {
      spreadsheet_id: "s1",
      range: "Sheet1!A1:B2",
      value_render_option: "FORMATTED_VALUE",
      response_format: "markdown",
    });
    expect(sheets.spreadsheets.values.get).toHaveBeenCalledWith(
      expect.objectContaining({ range: "Sheet1!A1:B2", valueRenderOption: "FORMATTED_VALUE" }),
    );
    expect(res.content[0].text).toContain("| h1 | h2 |");
    expect(res.structuredContent).toMatchObject({ row_count: 2 });
  });
});

describe("sheetsWriteRange", () => {
  it("passes values and input option, reports updated cells", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.update.mockResolvedValue({
      data: { updatedRange: "Sheet1!A1:B1", updatedCells: 2 },
    });
    const res = await sheetsWriteRange(asSheets(sheets), {
      spreadsheet_id: "s1",
      range: "Sheet1!A1",
      values: [["x", "y"]],
      value_input_option: "RAW",
    });
    expect(sheets.spreadsheets.values.update).toHaveBeenCalledWith(
      expect.objectContaining({
        valueInputOption: "RAW",
        requestBody: { values: [["x", "y"]] },
      }),
    );
    expect(res.structuredContent).toMatchObject({ updated_cells: 2 });
  });
});

describe("sheetsAddSheet / sheetsDeleteSheet", () => {
  it("adds a tab via batchUpdate", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addSheet: { properties: { sheetId: 42, title: "New" } } }] },
    });
    const res = await sheetsAddSheet(asSheets(sheets), { spreadsheet_id: "s1", title: "New" });
    expect(res.structuredContent).toMatchObject({ sheet_id: 42, title: "New" });
  });

  it("deletes a tab by numeric sheetId", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
    await sheetsDeleteSheet(asSheets(sheets), { spreadsheet_id: "s1", sheet_id: 42 });
    expect(sheets.spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ deleteSheet: { sheetId: 42 } }] },
      }),
    );
  });
});
