import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { sheets_v4 } from "googleapis";
import { type CellValue, SheetsAdapter } from "../sheets-adapter.js";
import {
  formatResponse,
  responseFormatSchema,
  type ToolResult,
  toolResult,
} from "../format.js";
import { type ArgsOf, registerAll, sheetsTool, type ToolRegistration } from "./define.js";

// ── Shared schema fragments & rendering ───────────────────────────────────────

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const valuesSchema = z
  .array(z.array(cellSchema))
  .describe("2D array of rows, each row an array of cell values");

const valueRenderOption = z
  .enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"])
  .default("FORMATTED_VALUE")
  .describe("How values are rendered (default FORMATTED_VALUE)");
const valueInputOption = z
  .enum(["USER_ENTERED", "RAW"])
  .default("USER_ENTERED")
  .describe("USER_ENTERED parses formulas/dates like the UI; RAW stores as-is");

function spreadsheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

function cell(v: CellValue | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

/** Render a 2D value grid as a markdown table (first row treated as header). */
function valuesToMarkdown(values: CellValue[][]): string {
  if (!values.length) return "(empty range)";
  const cols = Math.max(...values.map((r) => r.length));
  const row = (r: CellValue[]) => `| ${Array.from({ length: cols }, (_, i) => cell(r[i])).join(" | ")} |`;
  const [head, ...rest] = values;
  const lines = [row(head), `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`];
  for (const r of rest) lines.push(row(r));
  return lines.join("\n");
}

// ── Tools ─────────────────────────────────────────────────────────────────────
// Each tool: input schema → exported pure handler (unit-tested directly) →
// registration. Google API calls live in SheetsAdapter; handlers only translate
// args and shape the response.

const createSpreadsheetInput = {
  title: z.string().min(1),
  sheet_titles: z.array(z.string()).optional(),
};

export async function sheetsCreateSpreadsheet(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof createSpreadsheetInput>,
): Promise<ToolResult> {
  const summary = await new SheetsAdapter(sheets).createSpreadsheet({
    title: args.title,
    sheetTitles: args.sheet_titles,
  });
  const id = summary.spreadsheetId as string;
  return toolResult(`Created spreadsheet "${summary.title}" (${id})\n${spreadsheetUrl(id)}`, {
    spreadsheet_id: id,
    title: summary.title,
    url: spreadsheetUrl(id),
    sheets: summary.sheets,
  });
}

const createSpreadsheetTool = sheetsTool({
  name: "sheets_create_spreadsheet",
  title: "Create spreadsheet",
  description: `Create a new Google Spreadsheet.

Args:
  - title (string)
  - sheet_titles (string[], optional): initial tab names (default a single "Sheet1")

Returns: { spreadsheet_id, title, url, sheets:[{sheetId,title}] }`,
  inputSchema: createSpreadsheetInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: sheetsCreateSpreadsheet,
});

const getSpreadsheetInput = {
  spreadsheet_id: z.string().min(1),
  response_format: responseFormatSchema,
};

export async function sheetsGetSpreadsheet(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof getSpreadsheetInput>,
): Promise<ToolResult> {
  const summary = await new SheetsAdapter(sheets).getSpreadsheet(args.spreadsheet_id);
  const output = {
    spreadsheet_id: summary.spreadsheetId,
    title: summary.title,
    url: spreadsheetUrl(args.spreadsheet_id),
    sheets: summary.sheets,
  };
  const text = formatResponse(args.response_format, output, () =>
    [
      `# ${summary.title} (${summary.spreadsheetId})`,
      spreadsheetUrl(args.spreadsheet_id),
      "",
      ...summary.sheets.map((t) => `- **${t.title}** (sheetId ${t.sheetId}) — ${t.rows}×${t.columns}`),
    ].join("\n"),
  );
  return toolResult(text, output);
}

const getSpreadsheetTool = sheetsTool({
  name: "sheets_get_spreadsheet",
  title: "Get spreadsheet metadata",
  description: `Get a spreadsheet's tabs and dimensions (no cell values).

Args:
  - spreadsheet_id (string)
  - response_format ('markdown'|'json', default markdown)

Returns: { spreadsheet_id, title, url, sheets:[{sheetId,title,index,rows,columns}] }`,
  inputSchema: getSpreadsheetInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: sheetsGetSpreadsheet,
});

const readRangeInput = {
  spreadsheet_id: z.string().min(1),
  range: z.string().min(1).describe("A1 notation, e.g. 'Sheet1!A1:D20'"),
  value_render_option: valueRenderOption,
  response_format: responseFormatSchema,
};

export async function sheetsReadRange(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof readRangeInput>,
): Promise<ToolResult> {
  const { range, values } = await new SheetsAdapter(sheets).readRange({
    spreadsheetId: args.spreadsheet_id,
    range: args.range,
    valueRenderOption: args.value_render_option,
  });
  const output = { range, row_count: values.length, values };
  const text = formatResponse(args.response_format, output, () => `# ${range}\n\n${valuesToMarkdown(values)}`);
  return toolResult(text, output);
}

const readRangeTool = sheetsTool({
  name: "sheets_read_range",
  title: "Read a cell range",
  description: `Read cell values from one A1 range.

Args:
  - spreadsheet_id (string)
  - range (string): A1 notation, e.g. 'Sheet1!A1:D20' or 'Sheet1' for the whole tab
  - value_render_option ('FORMATTED_VALUE'|'UNFORMATTED_VALUE'|'FORMULA', default FORMATTED_VALUE)
  - response_format ('markdown'|'json', default markdown)

Returns: { range, row_count, values: CellValue[][] }`,
  inputSchema: readRangeInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: sheetsReadRange,
});

const readRangesInput = {
  spreadsheet_id: z.string().min(1),
  ranges: z.array(z.string().min(1)).min(1),
  value_render_option: valueRenderOption,
  response_format: responseFormatSchema,
};

export async function sheetsReadRanges(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof readRangesInput>,
): Promise<ToolResult> {
  const ranges = await new SheetsAdapter(sheets).readRanges({
    spreadsheetId: args.spreadsheet_id,
    ranges: args.ranges,
    valueRenderOption: args.value_render_option,
  });
  const output = { ranges };
  const text = formatResponse(
    args.response_format,
    output,
    () => ranges.map((r) => `# ${r.range}\n\n${valuesToMarkdown(r.values)}`).join("\n\n") || "(no ranges)",
  );
  return toolResult(text, output);
}

const readRangesTool = sheetsTool({
  name: "sheets_read_ranges",
  title: "Read multiple ranges",
  description: `Read several A1 ranges in one call (batchGet).

Args:
  - spreadsheet_id (string)
  - ranges (string[]): A1 ranges
  - value_render_option ('FORMATTED_VALUE'|'UNFORMATTED_VALUE'|'FORMULA', default FORMATTED_VALUE)
  - response_format ('markdown'|'json', default markdown)

Returns: { ranges: [{ range, values: CellValue[][] }] }`,
  inputSchema: readRangesInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: sheetsReadRanges,
});

const writeRangeInput = {
  spreadsheet_id: z.string().min(1),
  range: z.string().min(1),
  values: valuesSchema,
  value_input_option: valueInputOption,
};

export async function sheetsWriteRange(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof writeRangeInput>,
): Promise<ToolResult> {
  const result = await new SheetsAdapter(sheets).writeRange({
    spreadsheetId: args.spreadsheet_id,
    range: args.range,
    values: args.values,
    valueInputOption: args.value_input_option,
  });
  return toolResult(`Updated ${result.updatedCells ?? 0} cells in ${result.updatedRange ?? args.range}.`, {
    updated_range: result.updatedRange,
    updated_rows: result.updatedRows,
    updated_columns: result.updatedColumns,
    updated_cells: result.updatedCells,
  });
}

const writeRangeTool = sheetsTool({
  name: "sheets_write_range",
  title: "Write a cell range",
  description: `Overwrite cell values in an A1 range (values.update).

Args:
  - spreadsheet_id (string)
  - range (string): A1 notation; the top-left anchor for the written block
  - values (CellValue[][]): rows of cells (string|number|boolean|null)
  - value_input_option ('USER_ENTERED'|'RAW', default USER_ENTERED)

Returns: { updated_range, updated_rows, updated_columns, updated_cells }`,
  inputSchema: writeRangeInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  run: sheetsWriteRange,
});

const appendRowsInput = {
  spreadsheet_id: z.string().min(1),
  range: z.string().min(1),
  values: valuesSchema,
  value_input_option: valueInputOption,
  insert_data_option: z.enum(["INSERT_ROWS", "OVERWRITE"]).default("INSERT_ROWS"),
};

export async function sheetsAppendRows(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof appendRowsInput>,
): Promise<ToolResult> {
  const result = await new SheetsAdapter(sheets).appendRows({
    spreadsheetId: args.spreadsheet_id,
    range: args.range,
    values: args.values,
    valueInputOption: args.value_input_option,
    insertDataOption: args.insert_data_option,
  });
  return toolResult(
    `Appended ${result.updatedRows ?? 0} rows (${result.updatedCells ?? 0} cells) to ${result.tableRange ?? args.range}.`,
    {
      table_range: result.tableRange,
      updated_range: result.updatedRange,
      updated_rows: result.updatedRows,
      updated_cells: result.updatedCells,
    },
  );
}

const appendRowsTool = sheetsTool({
  name: "sheets_append_rows",
  title: "Append rows",
  description: `Append rows after the existing table in a range (values.append).

Args:
  - spreadsheet_id (string)
  - range (string): A1 range identifying the table to append to, e.g. 'Sheet1!A1'
  - values (CellValue[][]): rows to append
  - value_input_option ('USER_ENTERED'|'RAW', default USER_ENTERED)
  - insert_data_option ('INSERT_ROWS'|'OVERWRITE', default INSERT_ROWS)

Returns: { table_range, updated_range, updated_rows, updated_cells }`,
  inputSchema: appendRowsInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: sheetsAppendRows,
});

const clearRangeInput = {
  spreadsheet_id: z.string().min(1),
  range: z.string().min(1),
};

export async function sheetsClearRange(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof clearRangeInput>,
): Promise<ToolResult> {
  const clearedRange = await new SheetsAdapter(sheets).clearRange({
    spreadsheetId: args.spreadsheet_id,
    range: args.range,
  });
  return toolResult(`Cleared ${clearedRange ?? args.range}.`, { cleared_range: clearedRange });
}

const clearRangeTool = sheetsTool({
  name: "sheets_clear_range",
  title: "Clear a cell range",
  description: `Clear values from an A1 range (keeps formatting).

Args:
  - spreadsheet_id (string)
  - range (string): A1 notation

Returns: { cleared_range }`,
  inputSchema: clearRangeInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  run: sheetsClearRange,
});

const addSheetInput = {
  spreadsheet_id: z.string().min(1),
  title: z.string().min(1),
  rows: z.number().int().min(1).optional(),
  columns: z.number().int().min(1).optional(),
};

export async function sheetsAddSheet(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof addSheetInput>,
): Promise<ToolResult> {
  const tab = await new SheetsAdapter(sheets).addSheet({
    spreadsheetId: args.spreadsheet_id,
    title: args.title,
    rows: args.rows,
    columns: args.columns,
  });
  return toolResult(`Added sheet "${tab.title}" (sheetId ${tab.sheetId}).`, {
    sheet_id: tab.sheetId,
    title: tab.title,
  });
}

const addSheetTool = sheetsTool({
  name: "sheets_add_sheet",
  title: "Add a sheet (tab)",
  description: `Add a new tab to a spreadsheet.

Args:
  - spreadsheet_id (string)
  - title (string): new tab name
  - rows (number, optional): row count (default 1000)
  - columns (number, optional): column count (default 26)

Returns: { sheet_id, title }`,
  inputSchema: addSheetInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  run: sheetsAddSheet,
});

const deleteSheetInput = {
  spreadsheet_id: z.string().min(1),
  sheet_id: z.number().int().describe("Numeric sheetId (not the tab title)"),
};

export async function sheetsDeleteSheet(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof deleteSheetInput>,
): Promise<ToolResult> {
  await new SheetsAdapter(sheets).deleteSheet({
    spreadsheetId: args.spreadsheet_id,
    sheetId: args.sheet_id,
  });
  return toolResult(`Deleted sheet ${args.sheet_id}.`, { sheet_id: args.sheet_id });
}

const deleteSheetTool = sheetsTool({
  name: "sheets_delete_sheet",
  title: "Delete a sheet (tab)",
  description: `Delete a tab from a spreadsheet by its numeric sheetId (from sheets_get_spreadsheet).

Args:
  - spreadsheet_id (string)
  - sheet_id (number): the numeric sheetId of the tab to delete

Returns: { sheet_id }`,
  inputSchema: deleteSheetInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  run: sheetsDeleteSheet,
});

// ── Registration ────────────────────────────────────────────────────────────

export const sheetsTools: readonly ToolRegistration[] = [
  createSpreadsheetTool,
  getSpreadsheetTool,
  readRangeTool,
  readRangesTool,
  writeRangeTool,
  appendRowsTool,
  clearRangeTool,
  addSheetTool,
  deleteSheetTool,
];

export function registerSheetsTools(server: McpServer): void {
  registerAll(server, sheetsTools);
}
