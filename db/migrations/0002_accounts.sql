-- Accounts (src/accounts.ts): people claim their profiles with GitHub and connect the agents they enter challenges with.
-- These rows are not crawl data: scripts/db.ts push and pull leave them alone, and nothing in data/ mirrors them.
-- Secrets are stored as hashes only (src/accounts.ts hashSecret): the claim link, the agent's poll token, agent keys.

-- One per GitHub account that confirmed a claim
create table if not exists ocl.account (
  id            bigint primary key,                  -- GitHub's numeric user id: a login can change, this cannot
  login         text not null,
  name          text,
  avatar_url    text,
  display_name  text,                                -- what the person typed on the claim page
  bio           text,
  links         text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists account_login on ocl.account (lower(login));

-- Which profile (/u/{slug}, src/profiles.ts) belongs to which account. verified: the GitHub login is the profile's own;
-- pending: a GPU MODE, DuckBench or bare name, until a maintainer approves it (scripts/accounts.ts approve)
create table if not exists ocl.profile_claim (
  slug         text primary key,
  account_id   bigint not null references ocl.account (id) on delete cascade,
  status       text not null check (status in ('verified', 'pending')),
  method       text not null,                        -- github (OAuth) | gist | review
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists profile_claim_account on ocl.profile_claim (account_id);

-- A named agent of an account. The key is handed to the agent once; a new link with the same name replaces it.
create table if not exists ocl.agent (
  id            text primary key,                    -- public: /a/{id}
  account_id    bigint not null references ocl.account (id) on delete cascade,
  name          text not null,
  family        text not null,
  model         text,
  tool          text,
  description   text,
  key_hash      text unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
create unique index if not exists agent_name on ocl.agent (account_id, lower(name)) where revoked_at is null;

-- An agent's request for a claim link, and what became of it
create table if not exists ocl.connect_request (
  id              text primary key,                  -- public: in the gist proof's description
  token_hash      text not null unique,              -- the link's secret
  poll_hash       text not null unique,              -- the agent's secret for checking the link's status
  github          text,
  profiles        text[] not null default '{}',
  agent           jsonb not null,
  about           jsonb,
  status          text not null default 'open' check (status in ('open', 'confirmed')),
  account_id      bigint references ocl.account (id) on delete cascade,
  agent_id        text references ocl.agent (id) on delete set null,
  method          text,
  ip_hash         text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  confirmed_at    timestamptz,
  key_issued_at   timestamptz
);
create index if not exists connect_request_ip on ocl.connect_request (ip_hash, created_at);

-- "I am entering this challenge" / "here is my pull request": how entries are credited to an agent (src/profiles.ts linkEntries)
create table if not exists ocl.agent_event (
  id              bigint generated always as identity primary key,
  agent_id        text not null references ocl.agent (id) on delete cascade,
  kind            text not null check (kind in ('entering', 'submitted')),
  competition_id  text not null,
  problem_id      text,
  url             text,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists agent_event_agent on ocl.agent_event (agent_id, created_at desc);
create index if not exists agent_event_competition on ocl.agent_event (competition_id, created_at desc);

alter table ocl.account enable row level security;
alter table ocl.profile_claim enable row level security;
alter table ocl.agent enable row level security;
alter table ocl.connect_request enable row level security;
alter table ocl.agent_event enable row level security;
