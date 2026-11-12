# mcp-google-sheets

A small, security-first [MCP](https://modelcontextprotocol.io) server that lets Claude (or any MCP client) read and, if you allow it, append to your Google Sheets – without anyone copy-pasting business data into a chat window.

```
Claude Desktop / Claude Code / any MCP client
        │  MCP over stdio (runs on your machine or server)
        ▼
mcp-google-sheets ── allowlist · read-only by default · cell caps · audit log
        │  Google Sheets API v4, service account
        ▼
Only the spreadsheets you shared with the service account
```

## Tools

| Tool | What it does | Mode |
|---|---|---|
| `list_sheets` | Spreadsheet title, tabs, row/column counts | read |
| `read_range` | Cells in A1 notation (`'Orders'!A1:H200`), as displayed in the sheet | read |
| `find_rows` | Rows whose column (matched by header name) contains a query, with real row numbers | read |
| `append_rows` | Append rows to a tab (values parsed as if typed) | write, opt-in |

Example questions once connected: *"Which customers in the CRM sheet are in Malmö and still on trial?"*, *"Summarise last month's rows in Orders"*, *"Add these three leads to the Leads tab."*

## Security model

- **Allowlist, required.** The server refuses any spreadsheet ID not in `SHEETS_ALLOWED_IDS` before calling Google.
- **Read-only by default.** Write tools are not even registered unless `SHEETS_ALLOW_WRITES=true`, and the Google OAuth scope is `spreadsheets.readonly` in that mode, so Google enforces it too.
- **Least privilege at Google.** A service account only sees sheets explicitly shared with it. Share as *Viewer* for read-only use.
- **Bounded output.** At most `SHEETS_MAX_CELLS` (default 2000) cells per call, with a `truncated` flag so the model narrows the range instead of flooding its context.
- **Audit log without data.** Every call writes one JSON line to stderr: time, tool, spreadsheet ID, success. Cell values are never logged.
- **Runs where you run it.** stdio transport, no inbound network port, no third-party relay.

## Setup

1. **Google Cloud:** create a project, enable the *Google Sheets API*, create a *service account*, and download its JSON key.
2. **Share** each spreadsheet with the service account's e-mail (Viewer, or Editor if you enable writes).
3. **Build:** `npm ci && npm run build` (Node 20+).
4. **Connect your client.** Claude Desktop, `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "google-sheets": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-google-sheets/dist/index.js"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "/absolute/path/to/service-account.json",
        "SHEETS_ALLOWED_IDS": "1AbCdEf...your-sheet-id"
      }
    }
  }
}
```

Claude Code: `claude mcp add google-sheets --env SHEETS_ALLOWED_IDS=... --env GOOGLE_APPLICATION_CREDENTIALS=... -- node /absolute/path/to/dist/index.js`

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | yes | – | Path to the service-account key file |
| `SHEETS_ALLOWED_IDS` | yes | – | Comma-separated spreadsheet IDs, or `*` for every sheet shared with the account |
| `SHEETS_ALLOW_WRITES` | no | `false` | `true` registers `append_rows` and requests write scope |
| `SHEETS_MAX_CELLS` | no | `2000` | Max cells returned or written per call |

The spreadsheet ID is the part of the URL between `/d/` and `/edit`.

## Development

```bash
npm test          # 15 tests: tool logic + the real MCP client/server pair over an in-memory transport
npm run typecheck
npm run build
```

`src/gateway.ts` is the only file that talks to Google; tests swap it for an in-memory spreadsheet (`test/fake.ts`), so the suite runs offline and deterministically.

Built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`), `@googleapis/sheets` and zod.

## License

MIT
