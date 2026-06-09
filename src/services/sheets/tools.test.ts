import { beforeEach, describe, expect, it, vi } from "vitest";
import type { sheets_v4 } from "googleapis";

vi.mock("../../google/client.js", () => ({ getGoogleClients: vi.fn() }));

import {
  sheetsAddSheet,
  sheetsAppendRows,
  sheetsBatchUpdate,
  sheetsClearRange,
  sheetsCreateSpreadsheet,
  sheetsDeleteSheet,
  sheetsFormatCells,
  sheetsGetSpreadsheet,
  sheetsReadRange,
  sheetsReadRanges,
  sheetsSetDataValidation,
  sheetsWriteRange,
  sheetsWriteRanges,
} from "./tools.js";

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
        batchUpdate: vi.fn(),
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
        fields: "spreadsheetId,properties.title,sheets(properties(sheetId,title))",
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
    expect(sheets.spreadsheets.get).toHaveBeenCalledWith(
      expect.objectContaining({
        spreadsheetId: "s1",
        fields: "spreadsheetId,properties.title,sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
      }),
    );
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

const grid = { sheet_id: 0, start_row: 0, end_row: 2, start_column: 0, end_column: 3 };

describe("sheetsFormatCells", () => {
  it("builds a repeatCell request with only the given fields", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
    const res = await sheetsFormatCells(asSheets(sheets), {
      spreadsheet_id: "s1",
      ...grid,
      background_color: "#ffffff",
      bold: true,
    });
    const req = sheets.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests[0].repeatCell;
    expect(req.range).toEqual({
      sheetId: 0,
      startRowIndex: 0,
      endRowIndex: 2,
      startColumnIndex: 0,
      endColumnIndex: 3,
    });
    expect(req.cell.userEnteredFormat).toMatchObject({
      backgroundColor: { red: 1, green: 1, blue: 1 },
      textFormat: { bold: true },
    });
    expect(req.fields).toBe("userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.bold");
    expect(res.structuredContent).toMatchObject({ applied: true });
  });

  it("does nothing when no format options are passed", async () => {
    const sheets = fakeSheets();
    const res = await sheetsFormatCells(asSheets(sheets), { spreadsheet_id: "s1", ...grid });
    expect(sheets.spreadsheets.batchUpdate).not.toHaveBeenCalled();
    expect(res.structuredContent).toMatchObject({ applied: false });
  });
});

describe("sheetsSetDataValidation", () => {
  it("builds a ONE_OF_LIST dropdown rule", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockResolvedValue({ data: {} });
    await sheetsSetDataValidation(asSheets(sheets), {
      spreadsheet_id: "s1",
      ...grid,
      values: ["Yes", "No"],
      strict: true,
      show_dropdown: true,
    });
    const req = sheets.spreadsheets.batchUpdate.mock.calls[0][0].requestBody.requests[0].setDataValidation;
    expect(req.rule).toMatchObject({
      condition: { type: "ONE_OF_LIST", values: [{ userEnteredValue: "Yes" }, { userEnteredValue: "No" }] },
      strict: true,
      showCustomUi: true,
    });
  });
});

describe("sheetsWriteRanges", () => {
  it("sends one values.batchUpdate and reports totals + per-range counts", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.batchUpdate.mockResolvedValue({
      data: {
        totalUpdatedCells: 3,
        totalUpdatedRows: 2,
        responses: [
          { updatedRange: "Sheet1!A1:B1", updatedCells: 2 },
          { updatedRange: "Sheet2!A1", updatedCells: 1 },
        ],
      },
    });
    const res = await sheetsWriteRanges(asSheets(sheets), {
      spreadsheet_id: "s1",
      data: [
        { range: "Sheet1!A1:B1", values: [["a", "b"]] },
        { range: "Sheet2!A1", values: [["c"]] },
      ],
      value_input_option: "USER_ENTERED",
    });
    expect(sheets.spreadsheets.values.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          valueInputOption: "USER_ENTERED",
          data: [
            { range: "Sheet1!A1:B1", values: [["a", "b"]] },
            { range: "Sheet2!A1", values: [["c"]] },
          ],
        }),
      }),
    );
    expect(res.structuredContent).toMatchObject({ total_updated_cells: 3 });
    expect((res.structuredContent as { ranges: unknown[] }).ranges).toHaveLength(2);
  });
});

describe("sheetsBatchUpdate", () => {
  it("passes raw requests through and returns replies", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockResolvedValue({
      data: { replies: [{ addSheet: { properties: { sheetId: 7 } } }] },
    });
    const res = await sheetsBatchUpdate(asSheets(sheets), {
      spreadsheet_id: "s1",
      requests: [{ mergeCells: { mergeType: "MERGE_ALL" } }],
      response_format: "json",
    });
    expect(sheets.spreadsheets.batchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: { requests: [{ mergeCells: { mergeType: "MERGE_ALL" } }] },
      }),
    );
    expect(res.structuredContent).toMatchObject({ reply_count: 1 });
    expect(res.content[0].text).toContain('"sheetId": 7');
  });
});

// Error paths: every handler surfaces (does not swallow) an API rejection; the
// factory wrapper maps it to an isError result (covered by drive's "auth wrapper").
describe("handlers surface API errors", () => {
  const boom = { response: { status: 500 }, message: "boom" };

  it("sheetsCreateSpreadsheet rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.create.mockRejectedValue(boom);
    await expect(sheetsCreateSpreadsheet(asSheets(sheets), { title: "t" })).rejects.toBeDefined();
  });

  it("sheetsGetSpreadsheet rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.get.mockRejectedValue(boom);
    await expect(
      sheetsGetSpreadsheet(asSheets(sheets), { spreadsheet_id: "s1", response_format: "markdown" }),
    ).rejects.toBeDefined();
  });

  it("sheetsReadRange rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.get.mockRejectedValue(boom);
    await expect(
      sheetsReadRange(asSheets(sheets), {
        spreadsheet_id: "s1",
        range: "A1",
        value_render_option: "FORMATTED_VALUE",
        response_format: "markdown",
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsReadRanges rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.batchGet.mockRejectedValue(boom);
    await expect(
      sheetsReadRanges(asSheets(sheets), {
        spreadsheet_id: "s1",
        ranges: ["A1"],
        value_render_option: "FORMATTED_VALUE",
        response_format: "markdown",
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsWriteRange rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.update.mockRejectedValue(boom);
    await expect(
      sheetsWriteRange(asSheets(sheets), {
        spreadsheet_id: "s1",
        range: "A1",
        values: [["x"]],
        value_input_option: "RAW",
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsWriteRanges rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsWriteRanges(asSheets(sheets), {
        spreadsheet_id: "s1",
        data: [{ range: "A1", values: [["x"]] }],
        value_input_option: "RAW",
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsAppendRows rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.append.mockRejectedValue(boom);
    await expect(
      sheetsAppendRows(asSheets(sheets), {
        spreadsheet_id: "s1",
        range: "A1",
        values: [["x"]],
        value_input_option: "RAW",
        insert_data_option: "INSERT_ROWS",
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsClearRange rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.values.clear.mockRejectedValue(boom);
    await expect(
      sheetsClearRange(asSheets(sheets), { spreadsheet_id: "s1", range: "A1" }),
    ).rejects.toBeDefined();
  });

  it("sheetsAddSheet rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsAddSheet(asSheets(sheets), { spreadsheet_id: "s1", title: "x" }),
    ).rejects.toBeDefined();
  });

  it("sheetsDeleteSheet rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsDeleteSheet(asSheets(sheets), { spreadsheet_id: "s1", sheet_id: 1 }),
    ).rejects.toBeDefined();
  });

  it("sheetsFormatCells rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsFormatCells(asSheets(sheets), { spreadsheet_id: "s1", ...grid, bold: true }),
    ).rejects.toBeDefined();
  });

  it("sheetsSetDataValidation rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsSetDataValidation(asSheets(sheets), {
        spreadsheet_id: "s1",
        ...grid,
        values: ["a"],
        strict: true,
        show_dropdown: true,
      }),
    ).rejects.toBeDefined();
  });

  it("sheetsBatchUpdate rejects", async () => {
    const sheets = fakeSheets();
    sheets.spreadsheets.batchUpdate.mockRejectedValue(boom);
    await expect(
      sheetsBatchUpdate(asSheets(sheets), {
        spreadsheet_id: "s1",
        requests: [{ mergeCells: {} }],
        response_format: "markdown",
      }),
    ).rejects.toBeDefined();
  });
});
