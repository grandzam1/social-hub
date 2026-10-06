-- Append-only ledger for any tracked usage series.
-- A row is either a running total (api_request, upload_bytes, …),
-- a balance snapshot (*_snapshot, balance, remaining),
-- or an allowance (allowance, quota, given).

create table if not exists usage_events (
  id text primary key default catalog_rec_id(),
  service text not null,
  metric text not null,
  delta double precision not null,
  unit text not null,
  path text,
  method text,
  status_code integer,
  detail text,
  occurred_at timestamptz not null default now()
);

create index if not exists usage_events_occurred_at
  on usage_events (occurred_at desc);

create index if not exists usage_events_service_unit
  on usage_events (service, unit);

alter table usage_events enable row level security;

grant select, insert on table public.usage_events to service_role;

notify pgrst, 'reload schema';
