create table personas (
  id uuid primary key default gen_random_uuid(),
  puma text not null,
  borough text not null,
  neighborhood text,
  card jsonb not null,
  created_at timestamptz default now()
);

create index personas_puma_idx on personas (puma);
create index personas_borough_idx on personas (borough);

create table poll_runs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  status text default 'running',
  created_at timestamptz default now()
);

create table poll_batch_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references poll_runs(id),
  puma text not null,
  batch_index int not null,
  results jsonb not null,
  created_at timestamptz default now()
);

create index poll_batch_results_run_idx on poll_batch_results (run_id);
create index poll_batch_results_puma_idx on poll_batch_results (puma);
