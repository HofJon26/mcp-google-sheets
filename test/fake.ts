import type { CellValue, SheetsGateway } from "../src/gateway.js";

/** In-memory spreadsheet for tests. Understands "'Tab'" and "Tab!A1:C3" style ranges. */
export class FakeGateway implements SheetsGateway {
  readonly calls: string[] = [];
  constructor(
    readonly title: string,
    readonly tabs: Record<string, string[][]>,
  ) {}

  async getSpreadsheet(id: string) {
    this.calls.push(`get ${id}`);
    return {
      title: this.title,
      sheets: Object.entries(this.tabs).map(([title, rows], i) => ({
        title,
        sheetId: i,
        rowCount: rows.length,
        columnCount: Math.max(0, ...rows.map((r) => r.length)),
      })),
    };
  }

  async readRange(id: string, range: string) {
    this.calls.push(`read ${id} ${range}`);
    const [tabPart = "", a1] = range.split("!");
    const tab = this.tab(tabPart);
    if (!a1) return tab.map((r) => [...r]);
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1);
    if (!m) throw new Error(`fake: unsupported range ${a1}`);
    const [c1, r1, c2, r2] = [col(m[1] ?? "A"), Number(m[2]), col(m[3] ?? "A"), Number(m[4])];
    return tab.slice(r1 - 1, r2).map((r) => r.slice(c1, c2 + 1));
  }

  async appendRows(id: string, range: string, rows: CellValue[][]) {
    this.calls.push(`append ${id} ${range}`);
    const tab = this.tab(range);
    const start = tab.length + 1;
    tab.push(...rows.map((r) => r.map(String)));
    return { updatedRange: `${range}!A${start}:A${tab.length}`, updatedRows: rows.length };
  }

  private tab(ref: string): string[][] {
    const name = ref.startsWith("'") ? ref.slice(1, -1).replace(/''/g, "'") : ref;
    const tab = this.tabs[name];
    if (!tab) throw new Error(`Unable to parse range: ${ref}`);
    return tab;
  }
}

function col(letters: string): number {
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}
