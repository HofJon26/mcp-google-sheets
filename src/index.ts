#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createGoogleGateway } from "./gateway.js";
import { createServer } from "./server.js";

const config = loadConfig(process.env);
if (!config.allowedSpreadsheetIds) process.stderr.write("warning: SHEETS_ALLOWED_IDS=* allows every sheet shared with the service account\n");
process.stderr.write(`mcp-google-sheets: ${config.allowWrites ? "read-write" : "read-only"}, max ${config.maxCells} cells per call\n`);

const server = createServer(config, createGoogleGateway(config.allowWrites));
await server.connect(new StdioServerTransport());
