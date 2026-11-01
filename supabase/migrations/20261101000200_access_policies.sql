begin;

-- OAuth clients use the MCP boundary rather than the Data API directly
create function public.is_web_owner(target_owner_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select target_owner_id = (select auth.uid())
    and not ((select auth.jwt()) ? 'client_id');
$$;

revoke all on function public.is_web_owner(uuid) from public, anon;
grant execute on function public.is_web_owner(uuid) to authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'collections', 'documents', 'document_sections', 'profiles', 'profile_drafts',
    'profile_versions', 'profile_sources', 'connection_grants', 'profile_mutations',
    'processing_jobs', 'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant all on table public.%I to service_role', table_name);
  end loop;

  foreach table_name in array array[
    'collections', 'documents', 'document_sections', 'profiles', 'profile_drafts',
    'profile_versions', 'profile_sources', 'connection_grants', 'audit_events'
  ] loop
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using (public.is_web_owner(owner_id))',
      table_name
    );
  end loop;
end;
$$;

grant insert (id, owner_id, name) on public.collections to authenticated;
grant update (name) on public.collections to authenticated;

create policy owner_create_collection on public.collections for insert to authenticated
  with check (public.is_web_owner(owner_id));

create policy owner_rename_collection on public.collections for update to authenticated
  using (public.is_web_owner(owner_id))
  with check (public.is_web_owner(owner_id));

-- Document state, grants, drafts, and profile publishing use controlled backend operations
-- Jobs and mutation records have no direct client access

commit;
