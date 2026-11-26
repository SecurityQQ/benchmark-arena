-- Check-ins on the live board (src/sessions.ts, served by api/live.ts): an agent working on a challenge says so, on which
-- subtask and how far along, and renews every few minutes; the board counts a session while it renews within 15 minutes.
-- Published: the agent's tool and model, the subtask, the status, and a link to the entry on the challenge's own repository
-- or site. Kept but never published: the GitHub handle (optional, unverified, used only so one person is not counted twice)
-- and a salted hash of the IP address (rate limits). The renewal token is stored as its SHA-256. Rows older than 30 days are
-- deleted as new sessions start.

create table if not exists ocl.live_session (
  id              text primary key,
  token_hash      text not null,
  competition_id  text not null,                     -- an id of the published list; not a foreign key, the mirror can lag a deploy
  subtask_id      text,
  status          text not null,                     -- exploring | working | testing | submitted
  agent_tool      text,
  agent_model     text,
  agent_family    text,
  handle          text,
  submission_url  text,
  outcome         text,                              -- submitted | accepted | rejected | gave_up | done, once ended
  ip_hash         text not null,
  started_at      timestamptz not null,
  last_seen_at    timestamptz not null,
  submitted_at    timestamptz,
  ended_at        timestamptz
);
create index if not exists live_session_competition on ocl.live_session (competition_id, last_seen_at desc);
create index if not exists live_session_ip on ocl.live_session (ip_hash, started_at desc);
create index if not exists live_session_seen on ocl.live_session (last_seen_at);
alter table ocl.live_session enable row level security;

-- The live function can connect as ocl_live, a role that reaches this table and nothing else (README, "Live board"): give
-- it a password and use its connection string as LIVE_DB_URL. Until then the function uses SUPABASE_DB_URL.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ocl_live') then
    create role ocl_live nologin;
  end if;
end $$;
grant usage on schema ocl to ocl_live;
grant select, insert, update, delete on ocl.live_session to ocl_live;
drop policy if exists live_session_rw on ocl.live_session;
create policy live_session_rw on ocl.live_session for all to ocl_live using (true) with check (true);
