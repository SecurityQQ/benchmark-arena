// Vercel Routing Middleware: runs before the CDN cache on the routes agents use.
// 1. Accept: text/markdown on /, /c/{id} or /topics/{slug} gets the Markdown twin (llms.txt, the digest, the topic).
// 2. Non-browser fetches are counted as GA4 `agent_fetch` events, only when GA4_API_SECRET is set
//    (GA4 → Admin → Data streams → Measurement Protocol API secrets). See src/agentTraffic.ts for what is sent.
import { next, rewrite, waitUntil } from "@vercel/functions";
import { agentEvent, markdownFor } from "./src/agentTraffic.js";

export const config = {
  runtime: "nodejs",
  matcher: ["/", "/c/:id", "/join.txt", "/llms.txt", "/feed.xml", "/robots.txt", "/sitemap.xml", "/api/:path*", "/mcp", "/agents", "/agents/:family", "/people", "/standard", "/topics/:slug"],
};

const GA_ID = "G-W2QD0XKKEY"; // the same property as site/analytics.js

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.GA4_API_SECRET;
  if (secret) {
    const event = agentEvent(url.pathname, request.headers.get("user-agent"), request.headers.get("referer"));
    if (event) waitUntil(fetch(`https://www.google-analytics.com/mp/collect?measurement_id=${GA_ID}&api_secret=${encodeURIComponent(secret)}`, { method: "POST", body: JSON.stringify(event) }).catch(() => {}));
  }
  const md = markdownFor(url.pathname, request.headers.get("accept"));
  return md ? rewrite(new URL(md, url)) : next();
}
