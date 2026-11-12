import { describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { appendRows, findRows, listSheets, quoteSheet, readRange, ToolError } from "../src/tools.js";
import { FakeGateway } from "./fake.js";

const ID = "sheet-id-1234567890";
const cfg = (over: Partial<Config> = {}): Config => ({ allowedSpreadsheetIds: new Set([ID]), allowWrites: false, maxCells: 2000, ...over });
const crm = () =>
  new FakeGateway("CRM", {
    Customers: [
      ["Name", "Email", "Status"],
      ["Acme AB", "info@acme.se", "Active"],
      ["Beta Ltd", "hi@beta.io", "Churned"],
      ["Acme Labs", "lab@acme.se", "Trial"],
    ],
    "Q4 'Plan'": [["Goal"], ["Ship"]],
  });

describe("loadConfig", () => {
  it("requires an explicit allowlist and defaults to read-only", () => {
    expect(() => loadConfig({})).toThrow("SHEETS_ALLOWED_IDS");
    const c = loadConfig({ SHEETS_ALLOWED_IDS: " a , b " });
    expect([...(c.allowedSpreadsheetIds ?? [])]).toEqual(["a", "b"]);
    expect(c.allowWrites).toBe(false);
    expect(c.maxCells).toBe(2000);
  });

  it("supports '*' and opt-in writes, validates the cell cap", () => {
    expect(loadConfig({ SHEETS_ALLOWED_IDS: "*", SHEETS_ALLOW_WRITES: "TRUE" })).toMatchObject({ allowedSpreadsheetIds: null, allowWrites: true });
    expect(() => loadConfig({ SHEETS_ALLOWED_IDS: "a", SHEETS_MAX_CELLS: "0" })).toThrow("SHEETS_MAX_CELLS");
    expect(() => loadConfig({ SHEETS_ALLOWED_IDS: "a", SHEETS_MAX_CELLS: "abc" })).toThrow("SHEETS_MAX_CELLS");
  });
});

describe("allowlist", () => {
  it("never calls Google for a spreadsheet outside the allowlist", async () => {
    const gw = crm();
    await expect(readRange(gw, cfg(), "other-id-1234567890", "Customers")).rejects.toBeInstanceOf(ToolError);
    await expect(listSheets(gw, cfg(), "other-id-1234567890")).rejects.toThrow("allowlist");
    expect(gw.calls).toEqual([]);
  });

  it("allows any ID when the allowlist is '*'", async () => {
    const r = await listSheets(crm(), cfg({ allowedSpreadsheetIds: null }), "anything-goes-123");
    expect(r.sheets.map((s) => s.title)).toEqual(["Customers", "Q4 'Plan'"]);
  });
});

describe("readRange", () => {
  it("returns rows and caps cells per call", async () => {
    const full = await readRange(crm(), cfg(), ID, "Customers!A1:C4");
    expect(full).toMatchObject({ rowCount: 4, truncated: false });
    const capped = await readRange(crm(), cfg({ maxCells: 7 }), ID, "Customers");
    expect(capped.rows).toHaveLength(2);
    expect(capped).toMatchObject({ rowCount: 4, truncated: true });
  });
});

describe("findRows", () => {
  it("matches by header name, case-insensitive, with real row numbers", async () => {
    const r = await findRows(crm(), cfg(), { spreadsheetId: ID, sheet: "Customers", column: "email", query: "ACME", limit: 25 });
    expect(r.column).toBe("Email");
    expect(r.matches.map((m) => m.row)).toEqual([2, 4]);
    expect(r.matches[0]?.values).toEqual({ Name: "Acme AB", Email: "info@acme.se", Status: "Active" });
  });

  it("respects the limit and reports truncation", async () => {
    const r = await findRows(crm(), cfg(), { spreadsheetId: ID, sheet: "Customers", column: "Name", query: "a", limit: 1 });
    expect(r.matches).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });

  it("explains a missing column and handles quoted tab names", async () => {
    await expect(findRows(crm(), cfg(), { spreadsheetId: ID, sheet: "Customers", column: "Phone", query: "x", limit: 5 })).rejects.toThrow(
      "Headers: Name, Email, Status",
    );
    const r = await findRows(crm(), cfg(), { spreadsheetId: ID, sheet: "Q4 'Plan'", column: "Goal", query: "ship", limit: 5 });
    expect(r.matches).toHaveLength(1);
    expect(quoteSheet("Q4 'Plan'")).toBe("'Q4 ''Plan'''");
  });
});

describe("appendRows", () => {
  it("is refused while the server is read-only", async () => {
    const gw = crm();
    await expect(appendRows(gw, cfg(), { spreadsheetId: ID, sheet: "Customers", rows: [["x"]] })).rejects.toThrow("read-only");
    expect(gw.calls).toEqual([]);
  });

  it("appends when writes are enabled and enforces the cell cap", async () => {
    const gw = crm();
    const r = await appendRows(gw, cfg({ allowWrites: true }), { spreadsheetId: ID, sheet: "Customers", rows: [["Gamma", "g@g.se", "Trial"]] });
    expect(r.updatedRows).toBe(1);
    expect(gw.tabs.Customers?.at(-1)).toEqual(["Gamma", "g@g.se", "Trial"]);
    await expect(
      appendRows(gw, cfg({ allowWrites: true, maxCells: 2 }), { spreadsheetId: ID, sheet: "Customers", rows: [["a", "b", "c"]] }),
    ).rejects.toThrow("At most 2 cells");
  });
});
