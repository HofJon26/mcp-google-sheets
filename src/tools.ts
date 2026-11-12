import type { Config } from "./config.js";
import type { CellValue, SheetInfo, SheetsGateway } from "./gateway.js";

/** Errors the model should see and can act on (wrong ID, too much data). Anything else is logged and hidden. */
export class ToolError extends Error {}

export function assertAllowed(config: Config, spreadsheetId: string): void {
  if (config.allowedSpreadsheetIds && !config.allowedSpreadsheetIds.has(spreadsheetId)) {
    throw new ToolError(`Spreadsheet ${spreadsheetId} is not on this server's allowlist (SHEETS_ALLOWED_IDS).`);
  }
}

/** A1 sheet reference that survives spaces, quotes and names like "2024". */
export function quoteSheet(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

export async function listSheets(gw: SheetsGateway, config: Config, spreadsheetId: string): Promise<{ title: string; sheets: SheetInfo[] }> {
  assertAllowed(config, spreadsheetId);
  return gw.getSpreadsheet(spreadsheetId);
}

export interface ReadResult {
  range: string;
  rows: string[][];
  rowCount: number;
  truncated: boolean;
}

export async function readRange(gw: SheetsGateway, config: Config, spreadsheetId: string, range: string): Promise<ReadResult> {
  assertAllowed(config, spreadsheetId);
  const all = await gw.readRange(spreadsheetId, range);
  const { rows, truncated } = capCells(all, config.maxCells);
  return { range, rows, rowCount: all.length, truncated };
}

export interface FindResult {
  sheet: string;
  column: string;
  matches: { row: number; values: Record<string, string> }[];
  truncated: boolean;
}

/**
 * Rows whose `column` (matched by header text, case-insensitive) contains `query`.
 * Row numbers are the real sheet row numbers (header = row 1), so the model can cite or update them.
 */
export async function findRows(
  gw: SheetsGateway,
  config: Config,
  args: { spreadsheetId: string; sheet: string; column: string; query: string; limit: number },
): Promise<FindResult> {
  assertAllowed(config, args.spreadsheetId);
  const [header, ...body] = await gw.readRange(args.spreadsheetId, quoteSheet(args.sheet));
  if (!header) return { sheet: args.sheet, column: args.column, matches: [], truncated: false };

  const col = header.findIndex((h) => h.trim().toLowerCase() === args.column.trim().toLowerCase());
  if (col === -1) throw new ToolError(`Column "${args.column}" not found. Headers: ${header.join(", ")}`);

  const needle = args.query.trim().toLowerCase();
  const maxRows = Math.max(1, Math.min(args.limit, Math.floor(config.maxCells / Math.max(1, header.length))));
  const matches: FindResult["matches"] = [];
  let truncated = false;

  body.forEach((row, i) => {
    if (!(row[col] ?? "").toLowerCase().includes(needle)) return;
    if (matches.length >= maxRows) {
      truncated = true;
      return;
    }
    const values: Record<string, string> = {};
    header.forEach((h, j) => (values[h || `col${j + 1}`] = row[j] ?? ""));
    matches.push({ row: i + 2, values });
  });
  return { sheet: args.sheet, column: header[col] ?? args.column, matches, truncated };
}

export const MAX_APPEND_ROWS = 500;

export async function appendRows(
  gw: SheetsGateway,
  config: Config,
  args: { spreadsheetId: string; sheet: string; rows: CellValue[][] },
): Promise<{ updatedRange: string; updatedRows: number }> {
  if (!config.allowWrites) throw new ToolError("This server is read-only (set SHEETS_ALLOW_WRITES=true to enable writes).");
  assertAllowed(config, args.spreadsheetId);
  if (args.rows.length === 0) throw new ToolError("Nothing to append.");
  if (args.rows.length > MAX_APPEND_ROWS) throw new ToolError(`At most ${MAX_APPEND_ROWS} rows per call.`);
  const cells = args.rows.reduce((n, r) => n + r.length, 0);
  if (cells > config.maxCells) throw new ToolError(`At most ${config.maxCells} cells per call (got ${cells}).`);
  return gw.appendRows(args.spreadsheetId, quoteSheet(args.sheet), args.rows);
}

function capCells(rows: string[][], maxCells: number): { rows: string[][]; truncated: boolean } {
  const out: string[][] = [];
  let used = 0;
  for (const row of rows) {
    if (used + row.length > maxCells) return { rows: out, truncated: true };
    out.push(row);
    used += row.length;
  }
  return { rows: out, truncated: false };
}
