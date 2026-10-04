-- Initial schema. Applied by `npm run db:migrate`.
-- The app's server talks to these tables with the secret key (which bypasses Row Level Security);
-- RLS is enabled so the public publishable key can only do what the policies below allow.

-- Who fixes signals: NJDOT, a county engineering office, or a municipality's DPW.
create table agencies (
  id            text primary key,   -- 'njdot', 'somerset-county', 'hillsborough-township'
  name          text not null,
  type          text not null check (type in ('state', 'county', 'municipal')),
  county        text,               -- null for NJDOT
  municipality  text,               -- only for type = 'municipal'
  email         text,               -- null when the agency only takes web forms / phone
  form_url      text,
  phone         text,
  source_url    text not null,      -- where the contact info came from, so it can be re-checked
  verified      boolean not null default false, -- true once a person has confirmed the contact works
  manage_token  uuid not null unique default gen_random_uuid(), -- secret for the no-login agency page
  created_at    timestamptz not null default now()
);

create table signals (
  id                text primary key, -- 'osm-<lowest node id>', stable across re-imports
  osm_node_ids      bigint[] not null,
  lat               double precision not null,
  lng               double precision not null,
  name              text not null,
  roads             jsonb not null default '[]',
  owner_type        text not null check (owner_type in ('state', 'county', 'municipal')),
  via_ref           text,             -- the route number that decided ownership, e.g. 'US 206'
  municipality      text not null,
  county            text not null,
  status            text not null default 'ok' check (status in ('ok', 'reported', 'sent', 'acknowledged', 'fixed')),
  status_changed_at timestamptz not null default now()
);

create table reports (
  id           uuid primary key default gen_random_uuid(),
  signal_id    text not null references signals (id) on delete cascade,
  issue_type   text not null check (issue_type in ('stuck_red', 'dark', 'flashing', 'ped_button', 'other')),
  approach     text check (approach in ('northbound', 'eastbound', 'southbound', 'westbound')),
  wait_seconds int check (wait_seconds between 0 and 3600),
  note         text check (char_length(note) <= 500),
  reporter_id  text not null,         -- anonymous device id, for "2+ different people" and rate limits
  created_at   timestamptz not null default now()
);
create index reports_signal_time_idx on reports (signal_id, created_at desc);
create index reports_reporter_time_idx on reports (reporter_id, created_at desc);

create table digests (
  id          uuid primary key default gen_random_uuid(),
  agency_id   text not null references agencies (id),
  signal_ids  text[] not null,
  sent_to     text not null,          -- the real address, or the test inbox in test mode
  test_mode   boolean not null,
  sent_at     timestamptz not null default now()
);

alter table agencies enable row level security;
alter table signals  enable row level security;
alter table reports  enable row level security;
alter table digests  enable row level security;

-- The map is public. Everything else (reports, agencies, digests) is only reachable through the
-- app's server routes, which validate input and rate-limit before writing.
create policy "signals are public" on signals for select using (true);
