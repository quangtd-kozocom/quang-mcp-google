import { z } from "zod";
import type { sheets_v4 } from "googleapis";
import { type CellValue, SheetsAdapter } from "./adapter.js";
import {
  errorResult,
  formatResponse,
  responseFormatSchema,
  type ToolResult,
  toolResult,
} from "../../core/result.js";
import { type ArgsOf, sheetsTool, type ToolRegistration } from "../../core/tool.js";

// A newly created spreadsheet is returned under these structuredContent fields;
// the guard reads them to auto-grant the spreadsheet after a successful create.
function createdSpreadsheetId(structured: Record<string, unknown>): string | undefined {
  return typeof structured.spreadsheet_id === "string" ? structured.spreadsheet_id : undefined;
}
function createdSpreadsheetName(structured: Record<string, unknown>): string | undefined {
  return typeof structured.title === "string" ? structured.title : undefined;
}

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

// A GridRange targets cells by numeric sheetId + 0-based, end-exclusive indices
// (how batchUpdate addresses cells, unlike the A1 ranges used for values I/O).
const gridRangeInput = {
  spreadsheet_id: z.string().min(1),
  sheet_id: z.number().int().describe("Numeric sheetId from sheets_get_spreadsheet"),
  start_row: z.number().int().min(0).describe("0-based, inclusive"),
  end_row: z.number().int().min(0).describe("0-based, exclusive"),
  start_column: z.number().int().min(0).describe("0-based, inclusive"),
  end_column: z.number().int().min(0).describe("0-based, exclusive"),
};

function toGridRange(args: ArgsOf<typeof gridRangeInput>): sheets_v4.Schema$GridRange {
  return {
    sheetId: args.sheet_id,
    startRowIndex: args.start_row,
    endRowIndex: args.end_row,
    startColumnIndex: args.start_column,
    endColumnIndex: args.end_column,
  };
}

/** "#RRGGBB" → a Sheets Color (0–1 channels). */
function hexToColor(hex: string): sheets_v4.Schema$Color {
  const h = hex.replace(/^#/, "");
  return {
    red: parseInt(h.slice(0, 2), 16) / 255,
    green: parseInt(h.slice(2, 4), 16) / 255,
    blue: parseInt(h.slice(4, 6), 16) / 255,
  };
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
  policy: {
    action: "create",
    kind: "spreadsheet",
    newResourceId: createdSpreadsheetId,
    newResourceName: createdSpreadsheetName,
  },
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
  policy: { action: "read", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsGetSpreadsheet,
});

const readRangeInput = {
  spreadsheet_id: z.string().min(1),
  range: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .describe("A single A1 range (e.g. 'Sheet1!A1:D20'), or an array of A1 ranges to batch-read in one call"),
  value_render_option: valueRenderOption,
  response_format: responseFormatSchema,
};

export async function sheetsReadRange(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof readRangeInput>,
): Promise<ToolResult> {
  const adapter = new SheetsAdapter(sheets);
  // Array → values.batchGet (multi-range shape); single string → values.get (flat shape).
  if (Array.isArray(args.range)) {
    const ranges = await adapter.readRanges({
      spreadsheetId: args.spreadsheet_id,
      ranges: args.range,
      valueRenderOption: args.value_render_option,
    });
    const output = {
      count: ranges.length,
      ranges: ranges.map((r) => ({ range: r.range, row_count: r.values.length, values: r.values })),
    };
    const text = formatResponse(
      args.response_format,
      output,
      () => ranges.map((r) => `# ${r.range}\n\n${valuesToMarkdown(r.values)}`).join("\n\n") || "(no ranges)",
    );
    return toolResult(text, output);
  }
  const { range, values } = await adapter.readRange({
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
  title: "Read one or more cell ranges",
  description: `Read cell values from one A1 range, or several at once (batchGet).

Args:
  - spreadsheet_id (string)
  - range (string | string[]): a single A1 range (e.g. 'Sheet1!A1:D20' or 'Sheet1' for the whole tab),
    or an array of A1 ranges to read together in one call
  - value_render_option ('FORMATTED_VALUE'|'UNFORMATTED_VALUE'|'FORMULA', default FORMATTED_VALUE)
  - response_format ('markdown'|'json', default markdown)

Returns: a single range → { range, row_count, values: CellValue[][] };
an array of ranges → { count, ranges: [{ range, row_count, values }] }`,
  inputSchema: readRangeInput,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "read", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsReadRange,
});

const writeRangeInput = {
  spreadsheet_id: z.string().min(1),
  range: z.string().min(1).optional().describe("A1 range for a single-range write; the top-left anchor"),
  values: valuesSchema.optional().describe("Rows of cells to write when using 'range'"),
  data: z
    .array(z.object({ range: z.string().min(1), values: valuesSchema }))
    .min(1)
    .optional()
    .describe("For multi-range writes: list of {range, values} pairs; provide instead of range/values"),
  value_input_option: valueInputOption,
};

export async function sheetsWriteRange(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof writeRangeInput>,
): Promise<ToolResult> {
  const adapter = new SheetsAdapter(sheets);
  // 'data' → values.batchUpdate (multi-range shape); 'range'+'values' → values.update (flat shape).
  if (args.data) {
    const result = await adapter.batchWriteRanges({
      spreadsheetId: args.spreadsheet_id,
      data: args.data,
      valueInputOption: args.value_input_option,
    });
    return toolResult(
      `Updated ${result.totalUpdatedCells ?? 0} cells across ${result.responses.length} range(s).`,
      {
        total_updated_rows: result.totalUpdatedRows,
        total_updated_columns: result.totalUpdatedColumns,
        total_updated_cells: result.totalUpdatedCells,
        ranges: result.responses.map((r) => ({
          updated_range: r.updatedRange,
          updated_rows: r.updatedRows,
          updated_columns: r.updatedColumns,
          updated_cells: r.updatedCells,
        })),
      },
    );
  }
  if (!args.range || args.values === undefined) {
    return errorResult("Error: provide either 'range' + 'values' (single write) or 'data' (multi-range write).");
  }
  const result = await adapter.writeRange({
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
  title: "Write one or more cell ranges",
  description: `Overwrite cell values in one A1 range, or several at once (values.batchUpdate).

Cells store literal data, not formatted text. Write one value per cell — do NOT dump a markdown
table (or CSV/TSV) into a single cell or row. e.g. the markdown table
"| Name | Age |\\n| --- | --- |\\n| Ann | 30 |" must become rows
[["Name","Age"],["Ann",30]], and never include separator rows like ["---","---"]. For visual
styling (bold headers, colors, alignment) use sheets_format_cells, not markdown syntax in cells.

Args:
  - spreadsheet_id (string)
  - range (string, optional): A1 range for a single-range write. Prefer a top-left ANCHOR only
    (e.g. 'Sheet1!A1') — the block auto-sizes to 'values', so you can't mismatch. If you give a
    bounded range (e.g. 'Sheet1!A1:N50'), 'values' must fit exactly within it: more rows/cols than
    the range = Google 400 "tried writing to row [N]". When unsure, pass the anchor.
  - values (CellValue[][], optional): rows of cells (string|number|boolean|null) for 'range'
  - data (array, optional): for multi-range writes, [{ range: A1 string, values: CellValue[][] }, ...]
  - value_input_option ('USER_ENTERED'|'RAW', default USER_ENTERED): applied to every range

Provide either range+values (single) OR data (multiple).
Returns: single write → { updated_range, updated_rows, updated_columns, updated_cells };
multi-range write → { total_updated_rows, total_updated_columns, total_updated_cells,
  ranges:[{updated_range, updated_rows, updated_columns, updated_cells}] }`,
  inputSchema: writeRangeInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
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

Cells store literal data — one value per cell. Don't pack a markdown/CSV table into a single cell;
split into rows of cells and drop any "| --- |" separator rows.

Args:
  - spreadsheet_id (string)
  - range (string): A1 range identifying the table to append to, e.g. 'Sheet1!A1'
  - values (CellValue[][]): rows to append
  - value_input_option ('USER_ENTERED'|'RAW', default USER_ENTERED)
  - insert_data_option ('INSERT_ROWS'|'OVERWRITE', default INSERT_ROWS)

Returns: { table_range, updated_range, updated_rows, updated_cells }`,
  inputSchema: appendRowsInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
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
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
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
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
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
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsDeleteSheet,
});

const hexColor = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, "expected hex color like #4285F4");

const formatCellsInput = {
  ...gridRangeInput,
  background_color: hexColor.optional(),
  text_color: hexColor.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  font_size: z.number().int().min(1).optional(),
  horizontal_alignment: z.enum(["LEFT", "CENTER", "RIGHT"]).optional(),
};

export async function sheetsFormatCells(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof formatCellsInput>,
): Promise<ToolResult> {
  const format: sheets_v4.Schema$CellFormat = {};
  const text: sheets_v4.Schema$TextFormat = {};
  const fields: string[] = [];
  if (args.background_color !== undefined) {
    format.backgroundColor = hexToColor(args.background_color);
    fields.push("userEnteredFormat.backgroundColor");
  }
  if (args.horizontal_alignment !== undefined) {
    format.horizontalAlignment = args.horizontal_alignment;
    fields.push("userEnteredFormat.horizontalAlignment");
  }
  if (args.bold !== undefined) {
    text.bold = args.bold;
    fields.push("userEnteredFormat.textFormat.bold");
  }
  if (args.italic !== undefined) {
    text.italic = args.italic;
    fields.push("userEnteredFormat.textFormat.italic");
  }
  if (args.font_size !== undefined) {
    text.fontSize = args.font_size;
    fields.push("userEnteredFormat.textFormat.fontSize");
  }
  if (args.text_color !== undefined) {
    text.foregroundColor = hexToColor(args.text_color);
    fields.push("userEnteredFormat.textFormat.foregroundColor");
  }
  if (!fields.length) return toolResult("No formatting options given; nothing to change.", { applied: false });
  if (Object.keys(text).length) format.textFormat = text;

  await new SheetsAdapter(sheets).repeatCellFormat({
    spreadsheetId: args.spreadsheet_id,
    range: toGridRange(args),
    format,
    fields: fields.join(","),
  });
  return toolResult(`Formatted cells on sheet ${args.sheet_id}.`, { applied: true, fields });
}

const formatCellsTool = sheetsTool({
  name: "sheets_format_cells",
  title: "Format a cell range",
  description: `Apply cell formatting to a grid range (repeatCell). Only the options you pass are changed.

Args:
  - spreadsheet_id (string)
  - sheet_id (number): numeric sheetId from sheets_get_spreadsheet
  - start_row, end_row, start_column, end_column (number): 0-based; start inclusive, end exclusive
  - background_color, text_color (hex, optional): e.g. '#4285F4'
  - bold, italic (boolean, optional)
  - font_size (number, optional)
  - horizontal_alignment ('LEFT'|'CENTER'|'RIGHT', optional)

For formatting beyond these options (borders, merges, number/date formats, conditional formatting),
use sheets_batch_update.
Returns: { applied, fields }`,
  inputSchema: formatCellsInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsFormatCells,
});

const setDataValidationInput = {
  ...gridRangeInput,
  values: z.array(z.string()).min(1).describe("Dropdown options"),
  strict: z.boolean().default(true).describe("Reject values not in the list"),
  show_dropdown: z.boolean().default(true).describe("Show the dropdown UI arrow"),
};

export async function sheetsSetDataValidation(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof setDataValidationInput>,
): Promise<ToolResult> {
  await new SheetsAdapter(sheets).setDataValidation({
    spreadsheetId: args.spreadsheet_id,
    range: toGridRange(args),
    rule: {
      condition: { type: "ONE_OF_LIST", values: args.values.map((v) => ({ userEnteredValue: v })) },
      strict: args.strict,
      showCustomUi: args.show_dropdown,
    },
  });
  return toolResult(`Set a ${args.values.length}-option dropdown on sheet ${args.sheet_id}.`, {
    values: args.values,
  });
}

const setDataValidationTool = sheetsTool({
  name: "sheets_set_data_validation",
  title: "Set a dropdown on a range",
  description: `Add a dropdown (list) data-validation rule to a grid range (setDataValidation).

Args:
  - spreadsheet_id (string)
  - sheet_id (number): numeric sheetId from sheets_get_spreadsheet
  - start_row, end_row, start_column, end_column (number): 0-based; start inclusive, end exclusive
  - values (string[]): dropdown options
  - strict (boolean, default true): reject entries not in the list
  - show_dropdown (boolean, default true): show the dropdown arrow in the UI

For other validation rules (number/date/custom-formula conditions), use sheets_batch_update.
Returns: { values }`,
  inputSchema: setDataValidationInput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsSetDataValidation,
});

const batchUpdateInput = {
  spreadsheet_id: z.string().min(1),
  requests: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .describe("Raw Sheets API Request objects, each passed straight to batchUpdate"),
  response_format: responseFormatSchema,
};

export async function sheetsBatchUpdate(
  sheets: sheets_v4.Sheets,
  args: ArgsOf<typeof batchUpdateInput>,
): Promise<ToolResult> {
  const replies = await new SheetsAdapter(sheets).batchUpdate({
    spreadsheetId: args.spreadsheet_id,
    requests: args.requests,
  });
  const output = { reply_count: replies.length, replies };
  const text = formatResponse(
    args.response_format,
    output,
    () => `Applied ${args.requests.length} request(s); received ${replies.length} repl${replies.length === 1 ? "y" : "ies"}.`,
  );
  return toolResult(text, output);
}

const batchUpdateTool = sheetsTool({
  name: "sheets_batch_update",
  title: "Run raw batchUpdate requests",
  description: `Escape hatch: send raw Sheets API requests to spreadsheets.batchUpdate. Use for operations
without a dedicated tool (mergeCells, updateBorders, sortRange, addConditionalFormatRule, freezing
rows, etc.). Powerful and potentially destructive — a malformed request returns a Google 400.

Args:
  - spreadsheet_id (string)
  - requests (object[]): raw Request objects, e.g. [{ "mergeCells": { "range": {...}, "mergeType": "MERGE_ALL" } }]
  - response_format ('markdown'|'json', default markdown): 'json' to read the raw replies (e.g. a new sheetId)

Returns: { reply_count, replies: [...] }`,
  inputSchema: batchUpdateInput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  policy: { action: "write", kind: "spreadsheet", idArg: "spreadsheet_id" },
  run: sheetsBatchUpdate,
});

// ── Registration ────────────────────────────────────────────────────────────

export const sheetsTools: readonly ToolRegistration[] = [
  createSpreadsheetTool,
  getSpreadsheetTool,
  readRangeTool,
  writeRangeTool,
  appendRowsTool,
  clearRangeTool,
  addSheetTool,
  deleteSheetTool,
  formatCellsTool,
  setDataValidationTool,
  batchUpdateTool,
];
