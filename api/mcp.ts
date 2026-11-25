// Vercel Function for /mcp (vercel.json rewrites /mcp here): the read-only MCP server in src/mcp.ts.
// It reads the site's static files from https://openchallengelist.com, or from MCP_DATA_ORIGIN when set.
import { createMcpHandler } from "../src/mcp.js";

const handle = createMcpHandler({ origin: process.env.MCP_DATA_ORIGIN || undefined });

// Every method goes to the handler: POST and OPTIONS are served, the rest get a 405 that says how to connect
export const GET = handle, HEAD = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle, OPTIONS = handle;
