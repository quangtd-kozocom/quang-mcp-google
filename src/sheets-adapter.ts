import type { sheets_v4 } from "googleapis";

/** A single spreadsheet cell value as exchanged with the Sheets API. */
export type CellValue = string | number | boolean | null;

export interface SheetTab {
  sheetId?: number | null;
  title?: string | null;
  index?: number | null;
  rows?: number | null;
  columns?: number | null;
}

export interface SpreadsheetSummary {
  spreadsheetId?: string | null;
  title?: string | null;
  sheets: SheetTab[];
}

export interface RangeValues {
  range?: string | null;
  values: CellValue[][];
}

export interface WriteResult {
  updatedRange?: string | null;
  updatedRows?: number | null;
  updatedColumns?: number | null;
  updatedCells?: number | null;
}

export interface AppendResult {
  tableRange?: string | null;
  updatedRange?: string | null;
  updatedRows?: number | null;
  updatedCells?: number | null;
}

/**
 * Anti-corruption layer over the Sheets v4 API: every Google call lives here so
 * tool handlers deal in plain, intention-revealing shapes. Mirrors
 * {@link ../drive-adapter.DriveFileAdapter} so both services read the same way.
 */
export class SheetsAdapter {
  constructor(private readonly sheets: sheets_v4.Sheets) {}

  async createSpreadsheet(args: { title: string; sheetTitles?: string[] }): Promise<SpreadsheetSummary> {
    const { data } = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title: args.title },
        ...(args.sheetTitles?.length
          ? { sheets: args.sheetTitles.map((title) => ({ properties: { title } })) }
          : {}),
      },
      fields: "spreadsheetId, properties.title, sheets(properties(sheetId,title))",
    });
    return {
      spreadsheetId: data.spreadsheetId,
      title: data.properties?.title,
      sheets: (data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
      })),
    };
  }

  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetSummary> {
    const { data } = await this.sheets.spreadsheets.get({
      spreadsheetId,
      fields:
        "spreadsheetId, properties.title, sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))",
    });
    return {
      spreadsheetId: data.spreadsheetId,
      title: data.properties?.title,
      sheets: (data.sheets ?? []).map((s) => ({
        sheetId: s.properties?.sheetId,
        title: s.properties?.title,
        index: s.properties?.index,
        rows: s.properties?.gridProperties?.rowCount,
        columns: s.properties?.gridProperties?.columnCount,
      })),
    };
  }

  async readRange(args: {
    spreadsheetId: string;
    range: string;
    valueRenderOption: string;
  }): Promise<RangeValues> {
    const { data } = await this.sheets.spreadsheets.values.get({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
      valueRenderOption: args.valueRenderOption,
    });
    return { range: data.range, values: (data.values as CellValue[][]) ?? [] };
  }

  async readRanges(args: {
    spreadsheetId: string;
    ranges: string[];
    valueRenderOption: string;
  }): Promise<RangeValues[]> {
    const { data } = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: args.spreadsheetId,
      ranges: args.ranges,
      valueRenderOption: args.valueRenderOption,
    });
    return (data.valueRanges ?? []).map((vr) => ({
      range: vr.range,
      values: (vr.values as CellValue[][]) ?? [],
    }));
  }

  async writeRange(args: {
    spreadsheetId: string;
    range: string;
    values: CellValue[][];
    valueInputOption: string;
  }): Promise<WriteResult> {
    const { data } = await this.sheets.spreadsheets.values.update({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
      valueInputOption: args.valueInputOption,
      requestBody: { values: args.values },
    });
    return {
      updatedRange: data.updatedRange,
      updatedRows: data.updatedRows,
      updatedColumns: data.updatedColumns,
      updatedCells: data.updatedCells,
    };
  }

  async appendRows(args: {
    spreadsheetId: string;
    range: string;
    values: CellValue[][];
    valueInputOption: string;
    insertDataOption: string;
  }): Promise<AppendResult> {
    const { data } = await this.sheets.spreadsheets.values.append({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
      valueInputOption: args.valueInputOption,
      insertDataOption: args.insertDataOption,
      requestBody: { values: args.values },
    });
    return {
      tableRange: data.tableRange,
      updatedRange: data.updates?.updatedRange,
      updatedRows: data.updates?.updatedRows,
      updatedCells: data.updates?.updatedCells,
    };
  }

  async clearRange(args: { spreadsheetId: string; range: string }): Promise<string | null | undefined> {
    const { data } = await this.sheets.spreadsheets.values.clear({
      spreadsheetId: args.spreadsheetId,
      range: args.range,
    });
    return data.clearedRange;
  }

  async addSheet(args: {
    spreadsheetId: string;
    title: string;
    rows?: number;
    columns?: number;
  }): Promise<SheetTab> {
    const { data } = await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: args.title,
                ...(args.rows || args.columns
                  ? { gridProperties: { rowCount: args.rows ?? 1000, columnCount: args.columns ?? 26 } }
                  : {}),
              },
            },
          },
        ],
      },
    });
    const props = data.replies?.[0]?.addSheet?.properties;
    return { sheetId: props?.sheetId, title: props?.title };
  }

  async deleteSheet(args: { spreadsheetId: string; sheetId: number }): Promise<void> {
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: args.spreadsheetId,
      requestBody: { requests: [{ deleteSheet: { sheetId: args.sheetId } }] },
    });
  }
}
