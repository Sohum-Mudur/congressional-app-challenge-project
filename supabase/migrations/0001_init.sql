-- Initial schema. Run in the Supabase SQL editor (or `supabase db push`).

create extension if not exists postgis;

-- Who fixes signals: NJDOT, a county engineering office, or a municipality's DPW.
create table agencies (
  id            text primary key,   -- slug, e.g. 'njdot', 'somerset-county', 'hillsborough-township'
  name          text not null,
  type          text not null check (type in ('state', 'county', 'municipal')),
  county        text,               -- null for NJDOT
  municipality  text,               -- only for type = 'municipal'
  email         text,               -- null when the agency only takes web forms / phone
  form_url      text,
  phone         text,
  source_url    text not null,      -- where we got the contact info, so it can be re-checked
  manage_token  uuid not null default gen_random_uuid(), -- secret for the no-login agency page
  created_at    timestamptz not null default now()
);

create table signals (
  id             text primary key,  -- 'osm-<node id>', stable across re-imports
  osm_node_ids   bigint[] not null,
  location       geography(point, 4326) not null,
  name           text not null,
  roads          jsonb not null default '[]',
  owner_type     text not null check (owner_type in ('state', 'county', 'municipal')),
  owner_override text check (owner_override in ('state', 'county', 'municipal')), -- manual fix for maintenance agreements
  municipality   text not null,
  county         text not null,
  status         text not null default 'ok' check (status in ('ok', 'reported', 'sent', 'acknowledged', 'fixed')),
  status_changed_at timestamptz not null default now()
);
create index signals_location_idx on signals using gist (location);

create table reports (
  id               uuid primary key default gen_random_uuid(),
  signal_id        text not null references signals (id) on delete cascade,
  user_id          uuid references auth.users (id) on delete set null,
  issue_type       text not null check (issue_type in ('stuck_red', 'dark', 'flashing', 'ped_button', 'other')),
  approach         text check (approach in ('northbound', 'eastbound', 'southbound', 'westbound')),
  wait_seconds     int check (wait_seconds between 0 and 3600),
  note             text check (char_length(note) <= 500),
  reporter_id      text not null,  -- anonymous device id, for "2+ different people" and rate limiting
  created_at       timestamptz not null default now()
);
create index reports_signal_time_idx on reports (signal_id, created_at desc);

create table digests (
  id          uuid primary key default gen_random_uuid(),
  agency_id   text not null references agencies (id),
  signal_ids  text[] not null,
  sent_to     text not null,       -- the real address, or the test inbox in test mode
  test_mode   boolean not null,
  sent_at     timestamptz not null default now()
);

create table profiles (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  notify_fixed  boolean not null default true
);

-- Row Level Security: the public can read signals; everything else goes through
-- server routes that use the service role key.
alter table agencies enable row level security;
alter table signals  enable row level security;
alter table reports  enable row level security;
alter table digests  enable row level security;
alter table profiles enable row level security;

create policy "signals are public" on signals for select using (true);
create policy "own profile" on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
