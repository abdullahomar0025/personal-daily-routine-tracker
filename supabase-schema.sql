create table if not exists public.routine_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.routine_state enable row level security;
alter table public.routine_state force row level security;

revoke all on table public.routine_state from anon;
grant select, insert, update on table public.routine_state to authenticated;

drop policy if exists "Users can read their routine" on public.routine_state;
create policy "Users can read their routine"
on public.routine_state for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their routine" on public.routine_state;
create policy "Users can insert their routine"
on public.routine_state for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their routine" on public.routine_state;
create policy "Users can update their routine"
on public.routine_state for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'routine_state'
  ) then
    alter publication supabase_realtime add table public.routine_state;
  end if;
end $$;
