// src/accounts.ts Store in Postgres (db/migrations/0002_accounts.sql). One connection per function instance, through
// Supabase's transaction pooler: a function holds no session, so port 6543 replaces the session pooler's 5432.
import postgres from "postgres";
import type { About, Account, AgentInfo, AgentRow, Claim, ConnectRequest, EventRow, Store } from "./accounts.js";
import type { AgentFamily } from "./types.js";

type Sql = ReturnType<typeof postgres>;
type Row = Record<string, any>;

export function poolerUrl(url: string): string {
  return url.replace(/^(postgres(?:ql)?:\/\/[^@]+@[^/:]+\.pooler\.supabase\.com):5432\//, "$1:6543/");
}

export function connectAccounts(url: string): Sql {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  return postgres(poolerUrl(url), { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10, onnotice: () => {}, ssl: local ? false : "require" });
}

const t = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? undefined : String(v));
const opt = <V>(v: V | null | undefined) => (v == null ? undefined : v);

const account = (r: Row): Account => ({
  id: Number(r.id), login: r.login, name: opt(r.name), avatarUrl: opt(r.avatar_url), displayName: opt(r.display_name), bio: opt(r.bio),
  links: r.links ?? [], createdAt: t(r.created_at)!,
});
const agent = (r: Row): AgentRow => ({
  id: r.id, accountId: Number(r.account_id), name: r.name, family: r.family as AgentFamily, model: opt(r.model), tool: opt(r.tool),
  description: opt(r.description), createdAt: t(r.created_at)!, lastSeenAt: t(r.last_seen_at), revokedAt: t(r.revoked_at),
});
const claim = (r: Row): Claim => ({ slug: r.slug, accountId: Number(r.account_id), status: r.status, method: r.method, createdAt: t(r.created_at)! });
const request = (r: Row): ConnectRequest => ({
  id: r.id, tokenHash: r.token_hash, pollHash: r.poll_hash, github: opt(r.github), profiles: r.profiles ?? [], agent: r.agent as AgentInfo,
  about: opt(r.about) as About | undefined, status: r.status, accountId: r.account_id == null ? undefined : Number(r.account_id), agentId: opt(r.agent_id),
  method: opt(r.method), ipHash: r.ip_hash, createdAt: t(r.created_at)!, expiresAt: t(r.expires_at)!, confirmedAt: t(r.confirmed_at), keyIssuedAt: t(r.key_issued_at),
});
const event = (r: Row): EventRow => ({
  agentId: r.agent_id, kind: r.kind, competitionId: r.competition_id, problemId: opt(r.problem_id), url: opt(r.url), note: opt(r.note), createdAt: t(r.created_at)!,
});
const clean = <O extends object>(o: O) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as O;

export function pgStore(sql: Sql): Store {
  return {
    async recentRequests(ipHash, since) {
      const [r] = await sql`select count(*)::int as n from ocl.connect_request where ip_hash = ${ipHash} and created_at >= ${since}`;
      return r.n;
    },
    async createRequest(r) {
      await sql`insert into ocl.connect_request (id, token_hash, poll_hash, github, profiles, agent, status, ip_hash, created_at, expires_at)
        values (${r.id}, ${r.tokenHash}, ${r.pollHash}, ${r.github ?? null}, ${r.profiles}, ${sql.json(clean(r.agent) as any)}, 'open', ${r.ipHash}, ${r.createdAt}, ${r.expiresAt})`;
    },
    async requestByToken(h) { const [r] = await sql`select * from ocl.connect_request where token_hash = ${h}`; return r ? request(r) : null; },
    async requestByPoll(h) { const [r] = await sql`select * from ocl.connect_request where poll_hash = ${h}`; return r ? request(r) : null; },
    async setAbout(id, about) { await sql`update ocl.connect_request set about = ${sql.json(clean(about) as any)} where id = ${id} and status = 'open'`; },

    async confirm({ requestId, user, claims, method, now, newAgentId, about }) {
      return sql.begin(async (tx: any) => {
        const [r] = await tx`select * from ocl.connect_request where id = ${requestId} and status = 'open' for update`;
        if (!r) return null;
        const info = r.agent as AgentInfo;
        // a GitHub login moves with its account: whoever held it before (renamed since) gives it up
        await tx`update ocl.account set login = login || '~' || id::text where lower(login) = lower(${user.login}) and id <> ${user.id}`;
        await tx`insert into ocl.account (id, login, name, avatar_url, display_name, bio, links, created_at, updated_at)
          values (${user.id}, ${user.login}, ${user.name ?? null}, ${user.avatarUrl ?? null}, ${about?.displayName ?? null}, ${about?.bio ?? null}, ${about?.links ?? []}, ${now}, ${now})
          on conflict (id) do update set login = excluded.login, name = coalesce(excluded.name, ocl.account.name), avatar_url = coalesce(excluded.avatar_url, ocl.account.avatar_url),
            display_name = coalesce(excluded.display_name, ocl.account.display_name), bio = coalesce(excluded.bio, ocl.account.bio),
            links = case when cardinality(excluded.links) > 0 then excluded.links else ocl.account.links end, updated_at = excluded.updated_at`;
        for (const c of claims) {
          // a verified claim by someone else is kept unless this one is verified too (the GitHub login is the proof)
          await tx`insert into ocl.profile_claim (slug, account_id, status, method, created_at) values (${c.slug}, ${user.id}, ${c.status}, ${method}, ${now})
            on conflict (slug) do update set account_id = excluded.account_id, status = excluded.status, method = excluded.method, created_at = excluded.created_at, reviewed_at = null
            where not (ocl.profile_claim.account_id = excluded.account_id and ocl.profile_claim.status = 'verified')
              and (excluded.status = 'verified' or ocl.profile_claim.status <> 'verified')`;
        }
        const [same] = await tx`select id from ocl.agent where account_id = ${user.id} and lower(name) = lower(${info.name}) and revoked_at is null for update`;
        let agentId: string;
        if (same) {
          agentId = same.id;
          await tx`update ocl.agent set family = ${info.family}, model = ${info.model ?? null}, tool = ${info.tool ?? null}, description = coalesce(${info.description ?? null}, description), key_hash = null where id = ${agentId}`;
        } else {
          agentId = newAgentId;
          await tx`insert into ocl.agent (id, account_id, name, family, model, tool, description, created_at)
            values (${agentId}, ${user.id}, ${info.name}, ${info.family}, ${info.model ?? null}, ${info.tool ?? null}, ${info.description ?? null}, ${now})`;
        }
        await tx`update ocl.connect_request set status = 'confirmed', account_id = ${user.id}, agent_id = ${agentId}, method = ${method}, confirmed_at = ${now} where id = ${requestId}`;
        return { agentId };
      }) as Promise<{ agentId: string } | null>;
    },
    async issueKey(requestId, agentId, keyHash, now) {
      return sql.begin(async (tx: any) => {
        const res = await tx`update ocl.connect_request set key_issued_at = ${now} where id = ${requestId} and key_issued_at is null and agent_id = ${agentId}`;
        if (!res.count) return false;
        await tx`update ocl.agent set key_hash = ${keyHash} where id = ${agentId}`;
        return true;
      }) as Promise<boolean>;
    },
    async agentByKey(h) { const [r] = await sql`select * from ocl.agent where key_hash = ${h}`; return r ? agent(r) : null; },
    async agent(id) { const [r] = await sql`select * from ocl.agent where id = ${id}`; return r ? agent(r) : null; },
    async updateAgent(id, f) {
      try {
        await sql`update ocl.agent set
          name = coalesce(${f.name ?? null}, name), family = coalesce(${f.family ?? null}, family), model = coalesce(${f.model ?? null}, model),
          tool = coalesce(${f.tool ?? null}, tool), description = coalesce(${f.description ?? null}, description),
          last_seen_at = coalesce(${f.lastSeenAt ?? null}::timestamptz, last_seen_at), revoked_at = coalesce(${f.revokedAt ?? null}::timestamptz, revoked_at),
          key_hash = case when ${f.revokedAt ?? null}::timestamptz is null then key_hash end
          where id = ${id}`;
        return "ok";
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return "taken";
        throw e;
      }
    },
    async addEvent(e) {
      await sql`insert into ocl.agent_event (agent_id, kind, competition_id, problem_id, url, note, created_at)
        values (${e.agentId}, ${e.kind}, ${e.competitionId}, ${e.problemId ?? null}, ${e.url ?? null}, ${e.note ?? null}, ${e.createdAt})`;
    },
    async recentEvents(agentId, since) {
      const [r] = await sql`select count(*)::int as n from ocl.agent_event where agent_id = ${agentId} and created_at >= ${since}`;
      return r.n;
    },
    async account(id) { const [r] = await sql`select * from ocl.account where id = ${id}`; return r ? account(r) : null; },
    async claimOf(slug) { const [r] = await sql`select * from ocl.profile_claim where slug = ${slug}`; return r ? claim(r) : null; },
    async claimsOf(accountId) {
      return (await sql`select * from ocl.profile_claim where account_id = ${accountId} order by status = 'verified' desc, created_at`).map(claim);
    },
    async claims() {
      return (await sql`select c.*, a.login, (select count(*)::int from ocl.agent g where g.account_id = c.account_id and g.revoked_at is null) as agents
        from ocl.profile_claim c join ocl.account a on a.id = c.account_id order by c.created_at`).map((r: Row) => ({ ...claim(r), login: r.login, agents: r.agents }));
    },
    async agentsOf(accountId) {
      return (await sql`select * from ocl.agent where account_id = ${accountId} and revoked_at is null order by created_at`).map(agent);
    },
    async eventsOf(ids, limit) {
      if (!ids.length) return [];
      return (await sql`select * from ocl.agent_event where agent_id = any(${ids}::text[]) order by created_at desc limit ${limit}`).map(event);
    },
    async agents(limit) {
      return (await sql`select g.*, a.login from ocl.agent g join ocl.account a on a.id = g.account_id where g.revoked_at is null
        order by coalesce(g.last_seen_at, g.created_at) desc limit ${limit}`).map((r: Row) => ({ ...agent(r), login: r.login }));
    },
  };
}
