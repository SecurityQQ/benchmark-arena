// Tell IndexNow search engines (Bing — which also feeds ChatGPT search, Copilot and DuckDuckGo — Yandex, Seznam…)
// which pages changed, right after a production deploy. Reads the live sitemap: pages whose lastmod is within
// DAYS (default 2) are submitted, or every page with ALL=1.
//
//   node scripts/indexnow.mjs            # after a deploy (.github/workflows/indexnow.yml)
//   ALL=1 node scripts/indexnow.mjs      # first submission
import { readFileSync } from "node:fs";

const ORIGIN = process.env.SITE_ORIGIN ?? "https://openchallengelist.com";
const KEY = /INDEXNOW_KEY = "([0-9a-f]{32})"/.exec(readFileSync(new URL("../src/build.ts", import.meta.url), "utf-8"))?.[1];
if (!KEY) throw new Error("INDEXNOW_KEY not found in src/build.ts");

const keyFile = await fetch(`${ORIGIN}/${KEY}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== KEY) throw new Error(`key file not live at ${ORIGIN}/${KEY}.txt (${keyFile.status})`);

const xml = await (await fetch(`${ORIGIN}/sitemap.xml`)).text();
const since = new Date(Date.now() - Number(process.env.DAYS ?? 2) * 86400000).toISOString().slice(0, 10);
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)]
  .filter(([, , mod]) => process.env.ALL === "1" || mod >= since)
  .map(([, loc]) => loc.replace(/&amp;/g, "&"))
  .filter((u) => u.startsWith(ORIGIN + "/"));
if (!urls.length) { console.log("indexnow: nothing changed"); process.exit(0); }

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(ORIGIN).host, key: KEY, keyLocation: `${ORIGIN}/${KEY}.txt`, urlList: urls.slice(0, 10000) }),
});
console.log(`indexnow: ${urls.length} URL(s) → ${res.status} ${res.statusText}`);
// 200 OK and 202 Accepted are success; anything else should fail the job so it is noticed
if (res.status !== 200 && res.status !== 202) process.exit(1);
