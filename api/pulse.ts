// Vercel Function for /api/pulse and /api/pulse.md (vercel.json rewrites the .md twin here as ?format=md): what is happening
// right now across the boards, from the boards that publish live data (src/pulse.ts). No secrets: every source is public.
import { createPulseHandler } from "../src/pulse.js";

const handle = createPulseHandler({ origin: process.env.MCP_DATA_ORIGIN || undefined, log: (line) => console.log(line) });

export const GET = handle, HEAD = handle, OPTIONS = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
