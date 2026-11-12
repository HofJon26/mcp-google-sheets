import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Config } from "./config.js";
import type { SheetsGateway } from "./gateway.js";
import { appendRows, findRows, listSheets, MAX_APPEND_ROWS, readRange, ToolError } from "./tools.js";

/** One JSON line per tool call on stderr: who touched what, never the cell values. */
export type AuditLog = (entry: { tool: string; spreadsheetId: string; ok: boolean; detail?: string }) => void;

export const stderrAudit: AuditLog = (entry) => process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);

const spreadsheetId = z.string().min(10).max(100).describe("The ID from the sheet URL: docs.google.com/spreadsheets/d/<ID>/edit");
const sheetName = z.string().min(1).max(100).describe('Tab name, e.g. "Customers"');
const cell = z.union([z.string().max(5000), z.number(), z.boolean()]);

export function createServer(config: Config, gw: SheetsGateway, audit: AuditLog = stderrAudit): McpServer {
  const server = new McpServer({ name: "mcp-google-sheets", version: "0.1.0" });

  const run = async <T>(tool: string, id: string, work: () => Promise<T>) => {
    try {
      const result = await work();
      audit({ tool, spreadsheetId: id, ok: true });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      const message = e instanceof ToolError ? e.message : `Google Sheets error: ${e instanceof Error ? e.message : String(e)}`;
      audit({ tool, spreadsheetId: id, ok: false, detail: message });
      return { isError: true, content: [{ type: "text" as const, text: message }] };
    }
  };

  server.registerTool(
    "list_sheets",
    {
      title: "List tabs",
      description: "Title of a spreadsheet and its tabs with row/column counts. Start here to learn the layout.",
      inputSchema: z.object({ spreadsheetId }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run("list_sheets", args.spreadsheetId, () => listSheets(gw, config, args.spreadsheetId)),
  );

  server.registerTool(
    "read_range",
    {
      title: "Read range",
      description: `Read cells as displayed in the sheet, using A1 notation ("Customers!A1:F50" or just "Customers"). Returns at most ${config.maxCells} cells; "truncated" tells you to narrow the range.`,
      inputSchema: z.object({ spreadsheetId, range: z.string().min(1).max(200).describe("A1 range, e.g. 'Orders'!A1:H200") }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run("read_range", args.spreadsheetId, () => readRange(gw, config, args.spreadsheetId, args.range)),
  );

  server.registerTool(
    "find_rows",
    {
      title: "Find rows",
      description: "Rows in a tab whose column (by header name in row 1) contains the query, case-insensitive. Returns each match with its real row number.",
      inputSchema: z.object({
        spreadsheetId,
        sheet: sheetName,
        column: z.string().min(1).max(100).describe("Header text of the column to search"),
        query: z.string().min(1).max(200),
        limit: z.number().int().min(1).max(200).default(25),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run("find_rows", args.spreadsheetId, () => findRows(gw, config, args)),
  );

  if (config.allowWrites) {
    server.registerTool(
      "append_rows",
      {
        title: "Append rows",
        description: `Append rows after the last row of a tab. Values are entered as if typed by a user (formulas and dates are parsed). Max ${MAX_APPEND_ROWS} rows per call.`,
        inputSchema: z.object({ spreadsheetId, sheet: sheetName, rows: z.array(z.array(cell).min(1).max(100)).min(1).max(MAX_APPEND_ROWS) }),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async (args) => run("append_rows", args.spreadsheetId, () => appendRows(gw, config, args)),
    );
  }

  return server;
}
