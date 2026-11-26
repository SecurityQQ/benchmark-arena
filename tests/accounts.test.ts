import assert from "node:assert/strict";
import { test } from "node:test";
import { createAccountsHandler, gistDescription, memoryStore, CONNECTS_PER_HOUR } from "../src/accounts.js";
import { poolerUrl } from "../src/accountsDb.js";
import type { Profile } from "../src/profiles.js";

const ORIGIN = "https://openchallengelist.com";
const entry = (over: Partial<Profile["entries"][number]>): Profile["entries"][number] => ({
  competitionId: "duckbench", competitionName: "DuckBench", problemId: "race", problemName: "Race", value: 3, metricName: "time", direction: "minimize", rank: 1, of: 4, best: true, urls: [], ...over,
});
const PROFILES: Record<string, Partial<Profile>> = {
  octocat: { slug: "octocat", name: "octocat", github: "octocat", claim: "github", records: 2, competitions: [{ id: "duckbench", name: "DuckBench", records: 2, bests: 1 }], setups: [],
    entries: [entry({ date: "2026-11-20", urls: ["https://github.com/duck/bench/pull/7"] }), entry({ date: "2026-11-21", best: false, rank: 2, agent: { family: "anthropic", tool: "Claude Code", confidence: "high" } })] },
  "gpumode--octo": { slug: "gpumode--octo", name: "octo", claim: "review", records: 1, competitions: [{ id: "k", name: "Kernels", records: 1, bests: 0 }], setups: [], entries: [entry({ competitionId: "k" })] },
  hubot: { slug: "hubot", name: "hubot", github: "hubot", claim: "github", records: 1, competitions: [], setups: [], entries: [entry({})] },
};

interface Gist { description: string; created_at: string; public: boolean; owner: { id: number; login: string; avatar_url: string } }
function world(o: { signIn?: boolean } = {}) {
  let t = Date.parse("2026-11-26T10:00:00Z");
  const gists: Record<string, Gist[]> = {};
  const calls: string[] = [];
  const fetchMock = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
    const m = /^https:\/\/data\.test(\/api\/profiles\/([a-z0-9-]+)\.json)$/.exec(url);
    if (m) return PROFILES[m[2]] ? json(PROFILES[m[2]]) : json({ error: "not found" }, 404);
    if (url === "https://data.test/api/index.json") return json({ competitions: [{ id: "duckbench", name: "DuckBench" }, { id: "k", name: "Kernels" }] });
    if (url === "https://data.test/api/profiles.json") return json(Object.values(PROFILES).map((p) => ({ slug: p.slug, name: p.name, github: p.github, records: p.records, top: [] })));
    const g = /^https:\/\/api\.github\.com\/users\/([^/]+)\/gists/.exec(url);
    if (g) return json(gists[decodeURIComponent(g[1]).toLowerCase()] ?? []);
    if (url === "https://github.com/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.client_secret, "shh");
      return json(body.code === "good" ? { access_token: "gho_x" } : { error: "bad_verification_code" });
    }
    if (url === "https://api.github.com/user") return json({ id: 583231, login: "octocat", name: "The Octocat", avatar_url: "https://avatars.githubusercontent.com/u/583231" });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  const store = memoryStore();
  let n = 0;
  const handle = createAccountsHandler({
    store, origin: ORIGIN, dataOrigin: "https://data.test", fetch: fetchMock, now: () => t,
    random: (size) => Buffer.from(Array.from({ length: size }, (_, i) => (n * 31 + i * 7 + 3) % 256)).map((b, i) => (i === 0 ? n++ % 256 : b)) as Buffer,
    github: o.signIn ? { clientId: "cid", clientSecret: "shh" } : null,
  });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), "x-forwarded-for": "203.0.113.9", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  };
  const postGist = (login: string, id: number, requestId: string) => (gists[login.toLowerCase()] ??= []).push({ description: gistDescription(requestId), created_at: new Date(t).toISOString(), public: true, owner: { id, login, avatar_url: `https://avatars.githubusercontent.com/u/${id}` } });
  return { call, store, postGist, calls, advance: (ms: number) => { t += ms; }, handle };
}
const AGENT = { name: "Ada", model: "Claude Opus 5.5", tool: "Claude Code" };

test("accounts: an agent gets a link, its human proves it with a gist, the agent gets its key once and reports entries", async () => {
  const w = world();
  const c = await w.call("POST", "/connect", { github: "octocat", profiles: ["gpumode--octo", "hubot"], agent: AGENT });
  assert.equal(c.status, 201);
  assert.match(c.body.claimUrl, /^https:\/\/openchallengelist\.com\/claim#ocl_ct_[\w-]+$/);
  assert.match(c.body.pollToken, /^ocl_pt_/);
  assert.match(c.body.gist.command, /^gh gist create --public --desc "openchallengelist\.com claim cr_[a-z2-9]{10}"/);
  const token = c.body.claimUrl.split("#")[1];
  const poll = { Authorization: `Bearer ${c.body.pollToken}` };
  assert.equal((await w.call("GET", "/connect/status", undefined, poll)).body.status, "open");

  // the claim page: what is asked, and the link's cookie for the sign-in
  const open = await w.call("POST", "/connect/open", { token, about: { displayName: "Octo Cat", bio: "I race ducks.", links: ["https://octo.example"] } });
  assert.equal(open.status, 200);
  assert.equal(open.body.agent.family, "anthropic", "family from the model's name");
  assert.deepEqual(open.body.profiles.map((p: { slug: string; review: boolean }) => [p.slug, p.review]), [["octocat", false], ["gpumode--octo", true], ["hubot", false]]);
  assert.match(open.headers.get("set-cookie")!, /^ocl_claim=ocl_ct_[\w-]+; Path=\/api\/v1; HttpOnly; Secure; SameSite=Lax/);
  assert.equal(open.headers.get("access-control-allow-origin"), null, "cookie routes are same-origin only");

  // no gist yet, then the gist
  assert.equal((await w.call("POST", "/connect/confirm", { token })).status, 404);
  w.postGist("octocat", 583231, c.body.id);
  const ok = await w.call("POST", "/connect/confirm", { token });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.profile, "/u/octocat");
  assert.deepEqual(ok.body.skipped, ["hubot"], "someone else's GitHub profile is not claimed");
  assert.equal((await w.call("POST", "/connect/confirm", { token })).status, 409, "a link confirms once");

  const s1 = await w.call("GET", "/connect/status", undefined, poll);
  assert.equal(s1.body.status, "confirmed");
  assert.match(s1.body.agentKey, /^ocl_ak_[\w-]{40,}$/);
  assert.equal(s1.body.agent.name, "Ada");
  const s2 = await w.call("GET", "/connect/status", undefined, poll);
  assert.equal(s2.body.agentKey, undefined, "the key is handed out once");
  const key = { Authorization: `Bearer ${s1.body.agentKey}` };

  const me = await w.call("GET", "/agents/me", undefined, key);
  assert.equal(me.body.owner.login, "octocat");
  assert.equal((await w.call("GET", "/agents/me", undefined, { Authorization: "Bearer ocl_ak_nope" })).status, 401);

  // reporting: an unknown challenge is refused, a known one is recorded and credits the entry with that pull request
  assert.equal((await w.call("POST", "/agents/me/events", { kind: "entering", competition: "nope" }, key)).status, 400);
  assert.equal((await w.call("POST", "/agents/me/events", { kind: "submitted", competition: "duckbench" }, key)).status, 400, "submitted needs the link");
  const ev = await w.call("POST", "/agents/me/events", { kind: "submitted", competition: `${ORIGIN}/c/duckbench`, url: "https://github.com/duck/bench/pull/7" }, key);
  assert.equal(ev.status, 201);
  assert.equal(ev.body.recorded.competitionId, "duckbench");

  const prof = await w.call("GET", "/profiles/octocat");
  assert.equal(prof.body.claim.status, "verified");
  assert.equal(prof.body.account.displayName, "Octo Cat");
  assert.deepEqual(prof.body.account.links, ["https://octo.example/"]);
  assert.deepEqual(prof.body.profiles.map((p: { slug: string; status: string }) => [p.slug, p.status]), [["octocat", "verified"], ["gpumode--octo", "pending"]]);
  assert.deepEqual(prof.body.links, [{ entry: 0, agentId: me.body.agent.id, how: "reported" }, { entry: 1, agentId: me.body.agent.id, how: "matched" }]);
  assert.equal(prof.body.agents[0].stats.entries, 2);
  assert.equal(prof.headers.get("access-control-allow-origin"), "*");
  assert.equal((await w.call("GET", "/profiles/gpumode--octo")).body.claim.status, "pending");
  assert.equal((await w.call("GET", "/profiles/hubot")).body.claim, null);

  const ag = await w.call("GET", `/agents/${me.body.agent.id}`);
  assert.equal(ag.body.owner.login, "octocat");
  assert.equal(ag.body.entries.length, 2);
  assert.equal((await w.call("GET", "/agents")).body.agents[0].stats.entries, 2);
  assert.deepEqual((await w.call("GET", "/claims")).body.claims.map((x: { slug: string }) => x.slug).sort(), ["gpumode--octo", "octocat"]);

  // renaming keeps names unique per person; disconnecting kills the key
  assert.equal((await w.call("PATCH", "/agents/me", { name: "Ada Two", model: "Claude Fable 5.2" }, key)).body.agent.name, "Ada Two");
  assert.equal((await w.call("DELETE", "/agents/me", undefined, key)).status, 200);
  assert.equal((await w.call("GET", "/agents/me", undefined, key)).status, 401);
  assert.equal((await w.call("GET", `/agents/${me.body.agent.id}`)).status, 404);
});

test("accounts: signing in with GitHub confirms the link in this browser, and only with the matching state", async () => {
  const w = world({ signIn: true });
  const c = await w.call("POST", "/connect", { agent: AGENT });
  const token = c.body.claimUrl.split("#")[1];
  // no link cookie: back to the claim page
  assert.equal((await w.call("GET", "/auth/github")).headers.get("location"), "/claim?error=link");
  const start = await w.call("GET", "/auth/github", undefined, { Cookie: `ocl_claim=${token}` });
  assert.equal(start.status, 303);
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
  assert.equal(to.searchParams.get("redirect_uri"), `${ORIGIN}/api/v1/auth/github/callback`);
  assert.equal(to.searchParams.get("scope"), null, "no permissions asked");
  const state = to.searchParams.get("state")!;
  assert.match(start.headers.get("set-cookie")!, new RegExp(`^ocl_state=${state}; Path=/api/v1/auth; HttpOnly`));

  const cookies = { Cookie: `ocl_claim=${token}; ocl_state=${state}` };
  assert.equal((await w.call("GET", `/auth/github/callback?code=good&state=forged`, undefined, cookies)).headers.get("location"), "/claim?error=state");
  assert.equal((await w.call("GET", `/auth/github/callback?code=bad&state=${state}`, undefined, cookies)).headers.get("location"), "/claim?error=github");
  const done = await w.call("GET", `/auth/github/callback?code=good&state=${state}`, undefined, cookies);
  assert.match(done.headers.get("location")!, /^\/claim\?confirmed=octocat&agent=ag_[a-z2-9]{10}$/);
  assert.ok(done.headers.getSetCookie().some((x) => x.startsWith("ocl_claim=;")), "the link's cookie is cleared");
  const acct = await w.store.account(583231);
  assert.equal(acct?.login, "octocat");
  assert.equal((await w.call("GET", "/connect/status", undefined, { Authorization: `Bearer ${c.body.pollToken}` })).body.status, "confirmed");

  // a second link with the same agent name replaces the key rather than making a twin
  const c2 = await w.call("POST", "/connect", { agent: { name: "ada", model: "Claude Opus 5.5" } });
  const t2 = c2.body.claimUrl.split("#")[1];
  const s2 = new URL((await w.call("GET", "/auth/github", undefined, { Cookie: `ocl_claim=${t2}` })).headers.get("location")!).searchParams.get("state");
  await w.call("GET", `/auth/github/callback?code=good&state=${s2}`, undefined, { Cookie: `ocl_claim=${t2}; ocl_state=${s2}` });
  assert.equal((await w.store.agentsOf(583231)).length, 1);
});

test("accounts: links expire, inputs are checked, and one address cannot flood", async () => {
  const w = world();
  const bad = async (body: unknown) => (await w.call("POST", "/connect", body)).status;
  assert.equal(await bad({ agent: { name: "" } }), 400);
  assert.equal(await bad({ agent: { name: "<script>" } }), 400);
  assert.equal(await bad({ agent: AGENT, github: "not a login" }), 400);
  assert.equal(await bad({ agent: AGENT, profiles: ["../../etc"] }), 400);
  assert.equal(await bad({ agent: AGENT, profiles: ["name--nobody"] }), 400, "no such profile");
  assert.equal(await bad({ agent: { ...AGENT, secret: 1 } }), 400);
  assert.equal(await bad({ agent: AGENT, extra: true }), 400);
  const text = await w.handle(new Request(`${ORIGIN}/api/v1/connect`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ agent: AGENT }) }));
  assert.equal(text.status, 400, "JSON only: a cross-site form cannot post here");

  const c = await w.call("POST", "/connect", { agent: AGENT, github: "octocat" });
  const token = c.body.claimUrl.split("#")[1];
  w.advance(61 * 60 * 1000);
  assert.equal((await w.call("POST", "/connect/open", { token })).status, 410);
  assert.equal((await w.call("GET", "/connect/status", undefined, { Authorization: `Bearer ${c.body.pollToken}` })).body.status, "expired");
  w.postGist("octocat", 583231, c.body.id);
  assert.equal((await w.call("POST", "/connect/confirm", { token })).status, 410);
  assert.equal((await w.call("POST", "/connect/open", { token: "ocl_ct_guess" })).status, 404);

  // a gist from before the link was asked for, or from someone else, proves nothing
  const c2 = await w.call("POST", "/connect", { agent: AGENT, github: "octocat" });
  w.postGist("mallory", 666, c2.body.id);
  assert.equal((await w.call("POST", "/connect/confirm", { token: c2.body.claimUrl.split("#")[1] })).status, 404);

  for (let i = 0; i < CONNECTS_PER_HOUR; i++) await w.call("POST", "/connect", { agent: AGENT });
  assert.equal((await w.call("POST", "/connect", { agent: AGENT })).status, 429);
});

test("accounts: without a database the public search still works and the rest says so", async () => {
  const handle = createAccountsHandler({ store: null, origin: ORIGIN, dataOrigin: "https://data.test", fetch: (async () => new Response(JSON.stringify([{ slug: "octocat", name: "octocat", github: "octocat", records: 2, top: [] }]))) as unknown as typeof fetch });
  const search = await handle(new Request(`${ORIGIN}/api/v1/profiles?q=octo`));
  assert.equal(search.status, 200);
  assert.equal((await search.json()).profiles[0].url, `${ORIGIN}/u/octocat`);
  assert.equal((await handle(new Request(`${ORIGIN}/api/v1/connect`, { method: "POST" }))).status, 503);
  // the rewrite's form: /api/v1?path=…
  assert.equal((await handle(new Request(`${ORIGIN}/api/v1?path=profiles&q=oc`))).status, 200);
  assert.equal((await handle(new Request(`${ORIGIN}/api/v1/nope`))).status, 503);
});

test("accounts: the function talks to Supabase through the transaction pooler", () => {
  assert.equal(poolerUrl("postgresql://postgres.ref:pw@aws-0-us-west-2.pooler.supabase.com:5432/postgres"), "postgresql://postgres.ref:pw@aws-0-us-west-2.pooler.supabase.com:6543/postgres");
  assert.equal(poolerUrl("postgresql://u:p@localhost:5432/db"), "postgresql://u:p@localhost:5432/db");
});
