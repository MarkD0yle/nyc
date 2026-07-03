alter table public.personas enable row level security;
alter table public.poll_runs enable row level security;
alter table public.poll_batch_results enable row level security;

create policy "public read personas" on public.personas
  for select to anon, authenticated using (true);
create policy "public read poll_runs" on public.poll_runs
  for select to anon, authenticated using (true);
create policy "public read poll_batch_results" on public.poll_batch_results
  for select to anon, authenticated using (true);
