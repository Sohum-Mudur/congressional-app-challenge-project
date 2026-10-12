-- "Notify me when fixed", and a second anti-spam signal for the digest rule.

-- People who asked for one email when a light is fixed. Rows are deleted as soon as that email
-- is sent, so we never keep an address longer than needed.
create table fix_alerts (
  id          uuid primary key default gen_random_uuid(),
  signal_id   text not null references signals (id) on delete cascade,
  email       text not null check (char_length(email) <= 254),
  reporter_id text not null,          -- the device that asked, for rate limits
  created_at  timestamptz not null default now(),
  unique (signal_id, email)
);

alter table fix_alerts enable row level security; -- no policies: server only

-- Salted hash of the reporter's IP address (never the address itself). Clearing cookies makes a new
-- reporter_id, but not a new network, so the digest can require reports from 2+ networks.
alter table reports add column network_id text;
create index reports_network_time_idx on reports (network_id, created_at desc);
