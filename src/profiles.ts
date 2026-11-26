// Profiles: one page per person across every board, grouped by who they are rather than how each board spells them.
// A board credits "kellerjordan0, jxbz" or "@Grad62304977"; a GitHub link, a DuckBench handle or a GPU MODE name says
// whose entry it is. Every credited person gets a profile (/u/{slug}); the same GitHub account is one profile everywhere.
//
// Registered agents (src/accounts.ts) are linked to a profile's entries here too, so the site and the API agree on which
// agent made which entry.
import { createHash } from "node:crypto";
import type { AgentFamily, Competition, Problem, RecordEntry } from "./types.js";
import { isSubject } from "./aggregate.js";

export type Platform = "github" | "gpumode" | "duckbench" | "huggingface" | "kaggle" | "name";
export interface Identity { platform: Platform; handle: string; url?: string }

export interface ProfileEntry {
  competitionId: string; competitionName: string; problemId: string; problemName: string;
  date?: string; value: number; metricName: string; metricUnit?: string; direction: "minimize" | "maximize";
  rank: number; of: number;      // place among the track's entries (baselines left out), ties share a place
  best: boolean;                 // the current best in a contested track
  solo?: boolean;                // "best" only because nobody else entered the track
  as?: string;                   // the board's own credit when it names several people ("kellerjordan0, jxbz")
  urls: string[];                // submission links, https only, at most three
  agent?: { family: AgentFamily; model?: string; tool?: string; confidence: string };
}

// An AI agent this person's entries were credited to, by the crawler's evidence (Co-Authored-By trailers, PR bodies, branches)
export interface AgentSetup { family: AgentFamily; tool?: string; models: string[]; records: number; bests: number; lastUsed?: string }

export interface Profile {
  slug: string;
  name: string;
  aliases: string[];             // other spellings boards use for the same person
  identities: Identity[];
  github?: string;               // GitHub login, when an entry links the account
  avatar?: string;
  claim: "github" | "review";    // signing in as `github` proves it; anything else a maintainer reviews
  records: number; currentBests: number; uncontestedBests: number;
  competitions: { id: string; name: string; records: number; bests: number; lastActive?: string }[];
  setups: AgentSetup[];
  firstActive?: string; lastActive?: string;
  entries: ProfileEntry[];       // newest first
}

export interface ProfileIndexRow {
  slug: string; name: string; github?: string; avatar?: string; claim: Profile["claim"];
  records: number; currentBests: number; uncontestedBests: number; competitions: number;
  top: { id: string; name: string }[];
  families: Partial<Record<AgentFamily, number>>;
  lastActive?: string;
}

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/;
// GitHub logins: letters, digits and single hyphens, never at either end, at most 39 characters
export const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const GITHUB_PATHS = new Set("about apps collections contact customer-stories enterprise explore features issues login marketplace new notifications orgs organizations pricing pulls search security settings sponsors topics trending users".split(" "));
const HF_PATHS = new Set("blog datasets docs models organizations papers pricing spaces tasks".split(" "));
const KAGGLE_PATHS = new Set("code competitions datasets discussions docs learn models organizations".split(" "));
// Not a person, whatever the column says
const NOT_A_PERSON = /^(unknown|anonymous|n\/?a|none|null|tbd|-+|\?+|baseline\b.*|.*\bbaseline|reference( implementation)?|organizers?|maintainers?|.* maintainers)$/i;
const PREFIX: Record<Exclude<Platform, "github">, string> = { gpumode: "gpumode", duckbench: "duckbench", huggingface: "hf", kaggle: "kaggle", name: "name" };
const LABEL: Record<Platform, string> = { github: "GitHub", gpumode: "GPU MODE", duckbench: "DuckBench", huggingface: "Hugging Face", kaggle: "Kaggle", name: "Name on the board" };
export const platformLabel = (p: Platform) => LABEL[p];

const tidy = (s: string) => s.normalize("NFKC").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "").replace(/\s+/g, " ").trim();
const handleOf = (s: string) => tidy(s).replace(/^@+/, "").replace(/\s+et al\.?$/i, "").trim();

// Lower case, ASCII letters, digits and single hyphens: safe as a file name and a URL segment. A name with nothing left
// (an emoji, a script we do not transliterate) is named by a hash of itself.
const hash = (s: string, n: number) => createHash("sha256").update(s).digest("hex").slice(0, n);
export function slugify(s: string): string {
  const base = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return base || `h${hash(s, 10)}`;
}

// Two spellings are one person when they differ only in case, accents or separators ("Arseni Ivanov", "arseni_ivanov");
// any other character tells them apart ("D" and "D++" are two people on GPU MODE).
const sameName = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_.\-]+/g, "-").replace(/^-+|-+$/g, "");
const keyOf = (id: Identity) => `${id.platform}:${id.platform === "github" ? id.handle.toLowerCase() : sameName(id.handle)}`;

// A GitHub login is the profile's address as is; anything else carries its platform with a double hyphen, which no GitHub
// login can contain, so the two never collide.
const baseSlug = (id: Identity) => (id.platform === "github" ? id.handle.toLowerCase() : `${PREFIX[id.platform]}--${slugify(id.handle)}`);

// When two people reduce to one address, the one whose name is already that address keeps it (else the first by name) and
// the others get a hash of their name after it: the same data always gives the same addresses, whatever the counts.
function slugTable(ids: Identity[]): Map<string, string> {
  const groups = new Map<string, Map<string, Identity>>();
  for (const id of ids) {
    const base = baseSlug(id);
    if (!groups.has(base)) groups.set(base, new Map());
    groups.get(base)!.set(keyOf(id), id);
  }
  const table = new Map<string, string>();
  for (const [base, members] of groups) {
    const keys = [...members.keys()].sort();
    const plain = keys.find((k) => k.slice(k.indexOf(":") + 1) === base.slice(base.lastIndexOf("--") + (base.includes("--") ? 2 : 0))) ?? keys[0];
    for (const k of keys) table.set(k, k === plain ? base : `${base}-${hash(k, 6)}`);
  }
  return table;
}

// The people a credit names. Commas and semicolons always separate people; "and" or "&" only between handles, single words
// one of which has a digit, a separator or a capital inside ("jurajselep and b0nce"). "DreamingOfClouds and Rohan Arun" stays
// one credit rather than guess, and "Cats and boxes" is a team name.
const HANDLE_LIKE = /\d|[_.-]|.[A-Z]/;
export function creditedNames(credit: string): string[] {
  const s = tidy(credit);
  if (!s) return [];
  const and = /\s+(?:and|&)\s+/i;
  let parts: string[];
  if (/[,;]/.test(s)) parts = s.split(/\s*[,;]\s*/).flatMap((p) => p.split(and));
  else {
    const words = s.split(and);
    parts = words.length > 1 && words.every((w) => !/\s/.test(handleOf(w))) && words.some((w) => HANDLE_LIKE.test(handleOf(w))) ? words : [s];
  }
  return [...new Set(parts.map(handleOf).filter((p) => p && p.length <= 80 && !NOT_A_PERSON.test(p)))];
}

// Who a link says this is. Only a link to a person's own page counts: a pull request or a leaderboard page is not an identity.
export function identityFromUrl(url: string | undefined): Identity | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const seg = u.pathname.split("/").filter(Boolean);
  if (seg.length !== 1) return null;
  const one = decodeURIComponent(seg[0]);
  if (host === "github.com" && GITHUB_LOGIN.test(one) && !GITHUB_PATHS.has(one.toLowerCase())) return { platform: "github", handle: one, url: `https://github.com/${one}` };
  if (host === "duckbench.app" && /^@[\w.-]{1,60}$/.test(one)) return { platform: "duckbench", handle: one.slice(1), url: `https://duckbench.app/${one}` };
  if (host === "huggingface.co" && /^[\w.-]{1,60}$/.test(one) && !HF_PATHS.has(one.toLowerCase())) return { platform: "huggingface", handle: one, url: `https://huggingface.co/${one}` };
  if (host === "kaggle.com" && /^[\w.-]{1,60}$/.test(one) && !KAGGLE_PATHS.has(one.toLowerCase())) return { platform: "kaggle", handle: one, url: `https://www.kaggle.com/${one}` };
  return null;
}

const onGpuMode = (r: RecordEntry) => !!r.contributorUrl && /^https?:\/\/(www\.)?gpumode\.com\//i.test(r.contributorUrl);

// Every person a record credits, as identities. One named person with a profile link is that profile; several named people
// are each their own name on this board (a link next to a team credit belongs to the team, not to any one of them).
export function creditsOf(r: RecordEntry, c: Pick<Competition, "host">): Identity[] {
  if (!r.contributor || r.isBaseline || isSubject(r) || r.contributorKind === "model" || r.contributorKind === "method") return [];
  const names = creditedNames(r.contributor);
  const linked = identityFromUrl(r.contributorUrl);
  if (names.length === 1 && linked) return [linked];
  const platform: Platform = onGpuMode(r) ? "gpumode" : c.host === "kaggle" ? "kaggle" : "name";
  return names.map((handle) => {
    // "spartanhaden" next to github.com/spartanhaden inside a team credit: still that account
    if (linked && linked.handle.toLowerCase() === handle.toLowerCase()) return linked;
    return { platform, handle };
  });
}

// Within a track: 1 + how many entries did strictly better. Baselines are reference rows, not competitors.
function placesOf(p: Problem): Map<RecordEntry, { rank: number; of: number }> {
  const rows = p.records.filter((r) => !r.isBaseline && Number.isFinite(r.value));
  const better = (a: number, b: number) => (p.metricDirection === "minimize" ? a < b : a > b);
  return new Map(rows.map((r) => [r, { rank: 1 + rows.filter((o) => better(o.value, r.value)).length, of: rows.length }]));
}

const contested = (p: Problem) =>
  p.contested ?? new Set(p.records.filter((r) => !r.isBaseline).map((r) => (r.contributor ?? "").trim().toLowerCase()).filter(Boolean)).size >= 2;
const day = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : undefined);
const httpsLinks = (urls?: string[]) => (urls ?? []).filter((u) => /^https:\/\/[^\s]+$/i.test(u)).slice(0, 3);

export interface ProfileSet {
  profiles: Profile[];
  // the profiles a record credits, in the credit's order (an empty list for baselines, models and methods)
  slugsOf: (r: RecordEntry, c: Pick<Competition, "host">) => string[];
}

export function buildProfiles(comps: Competition[], maxEntries = 300): ProfileSet {
  // Pass 1: every identity. A bare name on a GitHub-hosted board that is exactly a GitHub login some entry links to is
  // that account ("@classiclarryd" in one table, github.com/classiclarryd in another).
  // login in lower case → its spelling in the first link to it (GitHub's own; a bare name's case is the board's)
  const githubLogins = new Map<string, string>();
  for (const c of comps) for (const p of c.problems) for (const r of p.records) for (const id of creditsOf(r, c)) if (id.platform === "github" && !githubLogins.has(id.handle.toLowerCase())) githubLogins.set(id.handle.toLowerCase(), id.handle);
  const resolve = (id: Identity, c: Pick<Competition, "host">): Identity => {
    const login = id.platform === "name" && c.host === "github" && GITHUB_LOGIN.test(id.handle) ? githubLogins.get(id.handle.toLowerCase()) : undefined;
    return login ? { platform: "github", handle: login, url: `https://github.com/${login}` } : id;
  };
  const all: Identity[] = [];
  for (const c of comps) for (const p of c.problems) for (const r of p.records) for (const id of creditsOf(r, c)) all.push(resolve(id, c));
  const table = slugTable(all);
  const slugOf = (id: Identity) => table.get(keyOf(id)) ?? baseSlug(id);

  interface Acc { profile: Profile; names: Map<string, number>; logins: Map<string, number>; ids: Map<string, Identity> }
  const bySlug = new Map<string, Acc>();
  for (const c of comps) for (const p of c.problems) {
    const places = placesOf(p), isContested = contested(p);
    for (const r of p.records) {
      const credits = creditsOf(r, c).map((id) => resolve(id, c));
      if (!credits.length) continue;
      const team = credits.length > 1;
      for (const id of credits) {
        const slug = slugOf(id);
        let acc = bySlug.get(slug);
        if (!acc) {
          acc = { names: new Map(), logins: new Map(), ids: new Map(), profile: {
            slug, name: id.handle, aliases: [], identities: [], claim: "review", records: 0, currentBests: 0, uncontestedBests: 0,
            competitions: [], setups: [], entries: [],
          } };
          bySlug.set(slug, acc);
        }
        const pr = acc.profile;
        const shown = team ? id.handle : handleOf(r.contributor!);
        acc.names.set(shown, (acc.names.get(shown) ?? 0) + 1);
        if (id.platform === "github") acc.logins.set(id.handle, (acc.logins.get(id.handle) ?? 0) + 1);
        const k = keyOf(id);
        if (!acc.ids.has(k) || (id.url && !acc.ids.get(k)!.url)) acc.ids.set(k, id);

        const best = !!r.isCurrentBest && isContested, solo = !!r.isCurrentBest && !isContested;
        const when = day(r.date);
        pr.records++;
        if (best) pr.currentBests++;
        if (solo) pr.uncontestedBests++;
        let cc = pr.competitions.find((x) => x.id === c.id);
        if (!cc) { cc = { id: c.id, name: c.name, records: 0, bests: 0 }; pr.competitions.push(cc); }
        cc.records++; if (best) cc.bests++;
        if (when && (!cc.lastActive || when > cc.lastActive)) cc.lastActive = when;
        if (when && (!pr.lastActive || when > pr.lastActive)) pr.lastActive = when;
        if (when && (!pr.firstActive || when < pr.firstActive)) pr.firstActive = when;

        const a = r.agent && r.agent.family !== "unknown" && r.agent.family !== "human" && (r.agent.role ?? "author") === "author" ? r.agent : undefined;
        if (a) {
          const tool = a.tool?.trim() || undefined;
          let s = pr.setups.find((x) => x.family === a.family && (x.tool ?? "").toLowerCase() === (tool ?? "").toLowerCase());
          if (!s) { s = { family: a.family, tool, models: [], records: 0, bests: 0 }; pr.setups.push(s); }
          s.records++; if (best) s.bests++;
          if (a.model && !s.models.includes(a.model)) s.models.push(a.model);
          if (when && (!s.lastUsed || when > s.lastUsed)) s.lastUsed = when;
        }
        const place = places.get(r) ?? { rank: 0, of: 0 };
        pr.entries.push({
          competitionId: c.id, competitionName: c.name, problemId: p.id, problemName: p.name,
          ...(when ? { date: when } : {}), value: r.value, metricName: p.metricName, ...(p.metricUnit ? { metricUnit: p.metricUnit } : {}),
          direction: p.metricDirection, rank: place.rank, of: place.of, best, ...(solo ? { solo } : {}),
          ...(team ? { as: tidy(r.contributor!) } : {}), urls: httpsLinks(r.submissionUrls),
          ...(a ? { agent: { family: a.family, ...(a.model ? { model: a.model } : {}), ...(a.tool ? { tool: a.tool } : {}), confidence: a.confidence } } : {}),
        });
      }
    }
  }

  const top = <K>(m: Map<K, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const profiles = [...bySlug.values()].map(({ profile: p, names, logins, ids }) => {
    const github = top(logins);
    p.identities = [...ids.values()].sort((a, b) => Number(b.platform === "github") - Number(a.platform === "github"));
    // A GitHub profile is named by its login unless the boards agree on another name for it
    p.name = github && !names.has(github) ? (top(names) ?? github) : (github ?? top(names) ?? p.name);
    p.aliases = [...names.keys()].filter((n) => n !== p.name).slice(0, 12);
    if (github) { p.github = github; p.avatar = `https://github.com/${github}.png?size=96`; p.claim = "github"; }
    p.competitions.sort((a, b) => b.bests - a.bests || b.records - a.records);
    p.setups.sort((a, b) => b.records - a.records);
    p.entries.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || Number(b.best) - Number(a.best) || a.rank - b.rank);
    p.entries = p.entries.slice(0, maxEntries);
    return p;
  }).sort((a, b) => b.currentBests - a.currentBests || b.records - a.records || a.slug.localeCompare(b.slug));

  return { profiles, slugsOf: (r, c) => [...new Set(creditsOf(r, c).map((id) => slugOf(resolve(id, c))))] };
}

export function profileIndex(profiles: Profile[]): ProfileIndexRow[] {
  return profiles.map((p) => {
    const families: Partial<Record<AgentFamily, number>> = {};
    for (const s of p.setups) families[s.family] = (families[s.family] ?? 0) + s.records;
    return {
      slug: p.slug, name: p.name, ...(p.github ? { github: p.github } : {}), ...(p.avatar ? { avatar: p.avatar } : {}), claim: p.claim,
      records: p.records, currentBests: p.currentBests, uncontestedBests: p.uncontestedBests, competitions: p.competitions.length,
      top: p.competitions.slice(0, 2).map((c) => ({ id: c.id, name: c.name })), families, ...(p.lastActive ? { lastActive: p.lastActive } : {}),
    };
  });
}

// The published dataset with each record's credited profiles and each participant's profile (when it is one person), so a
// board's leaderboard links to the people on it. Additive: nothing else in a competition changes.
export function withProfiles(comps: Competition[], set: ProfileSet): Competition[] {
  return comps.map((c) => {
    const one = new Map<string, string>();
    const problems = c.problems.map((p) => ({ ...p, records: p.records.map((r) => {
      const slugs = set.slugsOf(r, c);
      if (slugs.length === 1 && r.contributor) one.set(r.contributor.trim().toLowerCase(), slugs[0]);
      return slugs.length ? { ...r, profiles: slugs } : r;
    }) }));
    const participants = c.participants.map((u) => {
      const slug = one.get(u.name.trim().toLowerCase());
      return slug ? { ...u, profile: slug } : u;
    });
    return { ...c, problems, participants };
  });
}

// /api/people rows (src/aggregate.ts aggregatePeople, one per credit as boards spell it) with the profile of the person a
// credit names, when it names one: the home page's top contributors link to profiles
export function peopleWithProfiles<P extends { name: string }>(people: P[], published: Competition[]): (P & { slug?: string })[] {
  const one = new Map<string, string>();
  for (const c of published) for (const p of c.problems) for (const r of p.records) {
    const k = r.contributor?.toLowerCase();
    if (k && r.profiles?.length === 1 && !one.has(k)) one.set(k, r.profiles[0]);
  }
  return people.map((p) => { const slug = one.get(p.name.toLowerCase()); return slug ? { ...p, slug } : p; });
}

// ─── Registered agents ⇄ entries ───────────────────────────────────────────────────────────────────────────────────
export interface RegisteredAgent { id: string; name: string; family: AgentFamily; model?: string; tool?: string; createdAt: string }
export interface AgentEvent { agentId: string; kind: "entering" | "submitted"; competitionId: string; problemId?: string; url?: string; createdAt: string }
export interface EntryLink { slug: string; entry: number; agentId: string; how: "reported" | "matched" }

const loose = (s?: string) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
export const sameTool = (a?: string, b?: string) => { const x = loose(a), y = loose(b); return !x || !y || x.includes(y) || y.includes(x); };
// A pull request link and the links an entry carries: the same page, or a page under it (…/pull/12/files)
export function sameLink(reported: string, entryUrl: string): boolean {
  const norm = (u: string) => { try { const x = new URL(u); return `${x.hostname.toLowerCase().replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return ""; } };
  const a = norm(reported), b = norm(entryUrl);
  return !!a && !!b && (a === b || b.startsWith(`${a}/`));
}
const DAY = 86400000;

// Which of an account's agents made which entry:
// - reported: the agent sent the entry's pull request link, or said it was entering that competition (that track, when it
//   named one) up to two days before the entry's date and 60 days after, and the crawler's evidence does not name another family
// - matched: the crawler credited the entry to an AI agent and exactly one of the account's agents has that family and harness
// An entry two agents could have made stays unlinked.
export function linkEntries(profiles: Pick<Profile, "slug" | "entries">[], agents: RegisteredAgent[], events: AgentEvent[]): EntryLink[] {
  const links: EntryLink[] = [];
  const famOk = (e: ProfileEntry, a: RegisteredAgent) => !e.agent || e.agent.family === a.family;
  for (const p of profiles) p.entries.forEach((e, i) => {
    const urlHits = new Set(events.filter((ev) => ev.url && e.urls.some((u) => sameLink(ev.url!, u))).map((ev) => ev.agentId));
    let who = [...urlHits].filter((id) => agents.some((a) => a.id === id));
    if (who.length !== 1 && e.date) {
      const t = Date.parse(e.date);
      const near = events.filter((ev) => ev.competitionId === e.competitionId && (!ev.problemId || ev.problemId === e.problemId)
        && t >= Date.parse(ev.createdAt.slice(0, 10)) - 2 * DAY && t <= Date.parse(ev.createdAt) + 60 * DAY);
      who = [...new Set(near.map((ev) => ev.agentId))].filter((id) => { const a = agents.find((x) => x.id === id); return !!a && famOk(e, a); });
    }
    if (who.length === 1) { links.push({ slug: p.slug, entry: i, agentId: who[0], how: "reported" }); return; }
    if (!e.agent) return;
    const fits = agents.filter((a) => a.family === e.agent!.family && sameTool(a.tool, e.agent!.tool));
    if (fits.length === 1) links.push({ slug: p.slug, entry: i, agentId: fits[0].id, how: "matched" });
  });
  return links;
}

export interface AgentStats { entries: number; bests: number; reported: number; matched: number; competitions: { id: string; name: string; entries: number; bests: number }[]; lastEntry?: string }

export function agentStats(profiles: Pick<Profile, "slug" | "entries">[], links: EntryLink[], agentId: string): AgentStats {
  const s: AgentStats = { entries: 0, bests: 0, reported: 0, matched: 0, competitions: [] };
  for (const l of links) {
    if (l.agentId !== agentId) continue;
    const e = profiles.find((p) => p.slug === l.slug)?.entries[l.entry];
    if (!e) continue;
    s.entries++; if (e.best) s.bests++;
    if (l.how === "reported") s.reported++; else s.matched++;
    let c = s.competitions.find((x) => x.id === e.competitionId);
    if (!c) { c = { id: e.competitionId, name: e.competitionName, entries: 0, bests: 0 }; s.competitions.push(c); }
    c.entries++; if (e.best) c.bests++;
    if (e.date && (!s.lastEntry || e.date > s.lastEntry)) s.lastEntry = e.date;
  }
  s.competitions.sort((a, b) => b.bests - a.bests || b.entries - a.entries);
  return s;
}
