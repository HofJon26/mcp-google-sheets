import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import type { Config } from "../src/config.js";
import { createServer, type AuditLog } from "../src/server.js";
import { FakeGateway } from "./fake.js";

const ID = "sheet-id-1234567890";

/** Runs the real MCP server and a real MCP client over an in-memory transport. */
async function connect(over: Partial<Config> = {}) {
  const gw = new FakeGateway("CRM", { Customers: [["Name", "City"], ["Acme", "Malmö"], ["Beta", "Lund"]] });
  const audit: Parameters<AuditLog>[0][] = [];
  const server = createServer({ allowedSpreadsheetIds: new Set([ID]), allowWrites: false, maxCells: 2000, ...over }, gw, (e) => audit.push(e));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return { client, gw, audit };
}

const text = (r: { content?: unknown }) => {
  const first = (r.content as { type: string; text?: string }[] | undefined)?.[0];
  return first?.type === "text" ? (first.text ?? "") : "";
};

describe("MCP server", () => {
  it("exposes only read tools by default, marked read-only", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["find_rows", "list_sheets", "read_range"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("adds append_rows only when writes are enabled", async () => {
    const { client } = await connect({ allowWrites: true });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("append_rows");
  });

  it("answers a tool call end to end and writes an audit line without cell values", async () => {
    const { client, audit } = await connect();
    const res = await client.callTool({ name: "find_rows", arguments: { spreadsheetId: ID, sheet: "Customers", column: "City", query: "malmö" } });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(text(res)).matches).toEqual([{ row: 2, values: { Name: "Acme", City: "Malmö" } }]);
    expect(audit).toEqual([{ tool: "find_rows", spreadsheetId: ID, ok: true }]);
    expect(JSON.stringify(audit)).not.toContain("Acme");
  });

  it("returns a readable tool error for a sheet outside the allowlist", async () => {
    const { client, gw, audit } = await connect();
    const res = await client.callTool({ name: "read_range", arguments: { spreadsheetId: "not-allowed-123456", range: "Customers" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("allowlist");
    expect(gw.calls).toEqual([]);
    expect(audit[0]).toMatchObject({ tool: "read_range", ok: false });
  });

  it("passes Google errors through so the user can fix sharing", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "read_range", arguments: { spreadsheetId: ID, range: "Missing" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("Google Sheets error: Unable to parse range");
  });
});
