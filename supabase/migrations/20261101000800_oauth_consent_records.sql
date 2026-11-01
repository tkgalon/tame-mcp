begin;

create table public.mcp_oauth_clients (
  client_id uuid primary key references auth.oauth_clients(id) on delete cascade,
  resource_url text not null check (
    resource_url ~ '^https://[^/?#[:space:]@]+/mcp$'
    or resource_url ~ '^http://(localhost|127[.]0[.]0[.]1|\[::1\])(:[0-9]{1,5})?/mcp$'
  ),
  active boolean not null default true
);
create table public.mcp_oauth_consents (
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.mcp_oauth_clients(client_id) on delete cascade,
  approved_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (owner_id, client_id)
);
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_consents enable row level security;
revoke all on public.mcp_oauth_clients, public.mcp_oauth_consents from public, anon, authenticated;
grant all on public.mcp_oauth_clients, public.mcp_oauth_consents to service_role;
grant select on public.mcp_oauth_consents to authenticated;
create policy owner_read on public.mcp_oauth_consents for select to authenticated
  using (public.is_web_owner(owner_id));

create function public.keep_mcp_resource_binding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.client_id <> old.client_id or new.resource_url <> old.resource_url then
    raise exception 'Register a new OAuth client to change its resource.' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger mcp_resource_binding_immutable before update on public.mcp_oauth_clients
  for each row execute function public.keep_mcp_resource_binding();
revoke all on function public.keep_mcp_resource_binding() from public, anon, authenticated;

create function public.get_mcp_oauth_authorization(p_authorization_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null or not coalesce(public.is_web_owner(actor), false) then
    raise exception 'A web session is required.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'authorization_id', a.authorization_id, 'client_id', a.client_id,
    'client_name', c.client_name, 'resource_url', r.resource_url,
    'redirect_uri', a.redirect_uri, 'scope', a.scope, 'state', a.state,
    'status', a.status, 'user_id', a.user_id,
    'authorization_code', case when a.user_id = actor and a.status = 'approved' then a.authorization_code else null end
  ) into result
  from auth.oauth_authorizations a
  join auth.oauth_clients c on c.id = a.client_id and c.deleted_at is null
  join public.mcp_oauth_clients r on r.client_id = a.client_id and r.active
  where a.authorization_id = p_authorization_id and (a.user_id is null or a.user_id = actor)
    and a.status in ('pending', 'approved') and a.expires_at > clock_timestamp()
    and a.resource = r.resource_url and a.code_challenge_method = 's256';
  if result is null then raise exception 'Authorization not found.' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create function public.approve_mcp_oauth_consent(p_authorization_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  context jsonb;
begin
  context := public.get_mcp_oauth_authorization(p_authorization_id);
  if context ->> 'status' <> 'approved' or context ->> 'user_id' is distinct from auth.uid()::text then
    raise exception 'Provider approval is required.' using errcode = '42501';
  end if;
  insert into public.mcp_oauth_consents (owner_id, client_id)
    values (auth.uid(), (context ->> 'client_id')::uuid)
    on conflict (owner_id, client_id) do update
      set approved_at = clock_timestamp(), revoked_at = null;
  return true;
end;
$$;
revoke all on function public.get_mcp_oauth_authorization(text), public.approve_mcp_oauth_consent(text) from public, anon, authenticated;
grant execute on function public.get_mcp_oauth_authorization(text), public.approve_mcp_oauth_consent(text) to authenticated;

commit;
