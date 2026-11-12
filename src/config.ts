/** Runtime settings, read once from environment variables. Secure defaults: read-only, explicit allowlist. */
export interface Config {
  /** Spreadsheet IDs the server may touch. `null` = any sheet shared with the service account ("*"). */
  allowedSpreadsheetIds: ReadonlySet<string> | null;
  /** Write tools are only registered when this is true. */
  allowWrites: boolean;
  /** Upper bound on cells returned or written per call, so one call cannot flood the model's context. */
  maxCells: number;
}

export const DEFAULT_MAX_CELLS = 2000;

export function loadConfig(env: Record<string, string | undefined>): Config {
  const rawIds = env.SHEETS_ALLOWED_IDS?.trim();
  if (!rawIds) {
    throw new Error(
      'SHEETS_ALLOWED_IDS is required: a comma-separated list of spreadsheet IDs, or "*" to allow every sheet shared with the service account.',
    );
  }
  const ids = rawIds.split(",").map((s) => s.trim()).filter(Boolean);
  const allowedSpreadsheetIds = ids.includes("*") ? null : new Set(ids);

  const allowWrites = env.SHEETS_ALLOW_WRITES?.trim().toLowerCase() === "true";

  const rawMax = env.SHEETS_MAX_CELLS?.trim();
  const maxCells = rawMax ? Number(rawMax) : DEFAULT_MAX_CELLS;
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 50_000) {
    throw new Error("SHEETS_MAX_CELLS must be an integer between 1 and 50000.");
  }
  return { allowedSpreadsheetIds, allowWrites, maxCells };
}
