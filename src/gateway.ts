import { auth, sheets } from "@googleapis/sheets";

export type CellValue = string | number | boolean;

export interface SheetInfo {
  title: string;
  sheetId: number;
  rowCount: number;
  columnCount: number;
}

/** The only surface the tools use. Swappable in tests; one implementation talks to Google. */
export interface SheetsGateway {
  getSpreadsheet(spreadsheetId: string): Promise<{ title: string; sheets: SheetInfo[] }>;
  /** Values as the user sees them in the sheet (formatted strings). */
  readRange(spreadsheetId: string, range: string): Promise<string[][]>;
  appendRows(spreadsheetId: string, range: string, rows: CellValue[][]): Promise<{ updatedRange: string; updatedRows: number }>;
}

const SCOPE_READ = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SCOPE_WRITE = "https://www.googleapis.com/auth/spreadsheets";

/**
 * Google implementation. Credentials come from GOOGLE_APPLICATION_CREDENTIALS (a service-account key file),
 * and the OAuth scope is read-only unless writes are enabled, so Google itself enforces the mode too.
 */
export function createGoogleGateway(allowWrites: boolean): SheetsGateway {
  const googleAuth = new auth.GoogleAuth({ scopes: [allowWrites ? SCOPE_WRITE : SCOPE_READ] });
  const api = sheets({ version: "v4", auth: googleAuth });

  return {
    async getSpreadsheet(spreadsheetId) {
      const res = await api.spreadsheets.get({
        spreadsheetId,
        fields: "properties.title,sheets.properties(title,sheetId,gridProperties(rowCount,columnCount))",
      });
      return {
        title: res.data.properties?.title ?? "",
        sheets: (res.data.sheets ?? []).map((s) => ({
          title: s.properties?.title ?? "",
          sheetId: s.properties?.sheetId ?? 0,
          rowCount: s.properties?.gridProperties?.rowCount ?? 0,
          columnCount: s.properties?.gridProperties?.columnCount ?? 0,
        })),
      };
    },

    async readRange(spreadsheetId, range) {
      const res = await api.spreadsheets.values.get({ spreadsheetId, range, valueRenderOption: "FORMATTED_VALUE" });
      const values: unknown[][] = res.data.values ?? [];
      return values.map((row) => row.map((cell) => (cell === null || cell === undefined ? "" : String(cell))));
    },

    async appendRows(spreadsheetId, range, rows) {
      const res = await api.spreadsheets.values.append({
        spreadsheetId,
        range,
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: rows },
      });
      return {
        updatedRange: res.data.updates?.updatedRange ?? range,
        updatedRows: res.data.updates?.updatedRows ?? rows.length,
      };
    },
  };
}
