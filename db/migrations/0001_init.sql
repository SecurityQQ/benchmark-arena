-- The crawl's data in Postgres (Supabase), phase 0: the same data as data/*.json, one row per competition, problem, record and
-- attribution, plus the crawler's own memory (crawl state, discovered repositories, commit dates). src/db.ts maps the files to
-- these rows and back; scripts/db.ts applies this file and keeps the rows in step with the files.
--
-- Schema ocl is not one Supabase's Data API exposes; row level security is on with no policies as a second lock. The crawler
-- connects as the owner, which RLS does not restrict.
--
-- Every table has an `extra` jsonb for fields without a column, so a field added to the crawler's output survives before it gets
-- one. Timestamps the crawler writes stay text: it compares them as strings (main.ts canSkip), and timestamptz would reformat them.

create schema if not exists ocl;

-- One row per push: when, from which run, what the crawl reported
create table if not exists ocl.crawl_run (
  id            bigint generated always as identity primary key,
  mode          text not null,                       -- live | full | priority | process | repost | manual
  crawled_at    text not null,                       -- CrawlResult.crawledAt as written
  errors        jsonb not null default '[]',
  competitions  integer not null,
  records       integer not null,
  git_sha       text,
  pushed_at     timestamptz not null default now()
);

create table if not exists ocl.competition (
  id            text primary key,
  entry_key     text not null unique,                -- owner/name in lower case, or site:<id>: what the crawler de-duplicates by
  position      integer not null,
  name          text,
  tagline       text,
  description   text,
  url           text,
  repo          jsonb,
  repo_owner    text generated always as (repo->>'owner') stored,
  repo_name     text generated always as (repo->>'name') stored,
  host          text,
  status        text,
  domain        text,
  tags          text[],
  images        text[],
  organizer     jsonb,
  participation jsonb,
  compute       text generated always as (participation->>'compute') stored,
  venue         jsonb,
  quickstart    text,
  links         jsonb,
  standard      jsonb,
  agent_policy  jsonb,
  agent_docs    jsonb,
  last_updated  text,
  -- derived by postprocess from the records; stored until the build derives them itself
  participants  jsonb,
  stats         jsonb,
  agent_stats   jsonb,
  extra         jsonb not null default '{}'
);

create table if not exists ocl.problem (
  competition_id   text not null references ocl.competition (id) on delete cascade,
  id               text not null,
  position         integer not null,
  name             text,
  grp              text,
  description      text,
  metric_name      text,
  metric_unit      text,
  metric_direction text,
  baseline         double precision,
  pass_mark        double precision,
  is_open          boolean,                          -- derived
  contested        boolean,                          -- derived
  extra            jsonb not null default '{}',
  primary key (competition_id, id)
);

-- rid: a hash of what identifies an entry (competition, track, contributor, value, date, first link; src/db.ts recordId), so the
-- same entry keeps its row, and its first_seen_at, from one crawl to the next
create table if not exists ocl.record (
  rid              text primary key,
  competition_id   text not null,
  problem_id       text not null,
  position         integer not null,
  "date"           text,
  value            double precision,
  contributor      text,
  contributor_kind text,
  contributor_url  text,
  description      text,
  submission_urls  text[],
  is_current_best  boolean,
  is_baseline      boolean,
  passed           boolean,
  extra            jsonb not null default '{}',
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  foreign key (competition_id, problem_id) references ocl.problem (competition_id, id) on delete cascade
);
create index if not exists record_problem on ocl.record (competition_id, problem_id, position);
create index if not exists record_contributor on ocl.record (lower(contributor));
create index if not exists record_first_seen on ocl.record (first_seen_at);

-- Which AI agent produced an entry, and the evidence (one per record today; its own table so a record can carry several later)
create table if not exists ocl.attribution (
  rid         text primary key references ocl.record (rid) on delete cascade,
  family      text,
  model       text,
  tool        text,
  evidence    text,
  confidence  text,
  role        text,
  extra       jsonb not null default '{}'
);
create index if not exists attribution_family on ocl.attribution (family);

-- data/crawl-state.json: what the last LLM pass saw per repository
create table if not exists ocl.repo_state (
  repo_key        text primary key,
  pushed_at       text,
  fingerprint     text,
  verdict         text,
  checked_at      text,
  head            text,
  sources         text[],
  live            boolean,
  live_failed_at  text,
  extra           jsonb not null default '{}'
);

-- data/discovered.json, in its order
create table if not exists ocl.discovered_repo (
  position        integer primary key,
  owner           text,
  name            text,
  url             text,
  description     text,
  stars           double precision,
  topics          text[],
  default_branch  text,
  pushed_at       text,
  priority        boolean,
  extra           jsonb not null default '{}'
);

-- data/commit-dates.json: sha → day, null when GitHub does not know the commit
create table if not exists ocl.commit_date (
  sha  text primary key,
  day  text
);

-- Files kept whole, byte for byte (json, not jsonb): data/discoveries.json, data/agent-docs.json
create table if not exists ocl.document (
  key         text primary key,
  body        json not null,
  updated_at  timestamptz not null default now()
);

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'ocl' loop
    execute format('alter table ocl.%I enable row level security', t);
  end loop;
  -- Supabase's API roles: no way into this schema, whatever a later grant on public does
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema ocl from anon, authenticated;
  end if;
end $$;
