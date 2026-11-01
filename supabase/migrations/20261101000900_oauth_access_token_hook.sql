begin;

create function public.mcp_access_token_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claims jsonb := event -> 'claims';
  v_client_id uuid;
  v_owner_id uuid;
  v_session_id uuid;
  registration public.mcp_oauth_clients;
  consent public.mcp_oauth_consents;
  connection public.connection_grants;
begin
  -- Web sessions keep their original audience and claims
  if nullif(claims ->> 'client_id', '') is null then return jsonb_build_object('claims', claims); end if;
  v_client_id := (claims ->> 'client_id')::uuid;
  select * into registration from public.mcp_oauth_clients r where r.client_id = v_client_id for share;
  if not found then return jsonb_build_object('claims', claims); end if;
  v_owner_id := (claims ->> 'sub')::uuid;
  v_session_id := (claims ->> 'session_id')::uuid;
  if not registration.active or claims ->> 'role' is distinct from 'authenticated'
    or event ->> 'user_id' is distinct from v_owner_id::text then
    raise exception 'MCP authorization is unavailable.' using errcode = '42501';
  end if;
  select * into consent from public.mcp_oauth_consents c
    where c.owner_id = v_owner_id and c.client_id = v_client_id and c.revoked_at is null for share;
  if not found then raise exception 'MCP consent is required.' using errcode = '42501'; end if;
  perform 1 from auth.sessions s where s.id = v_session_id and s.user_id = v_owner_id
    and s.oauth_client_id = v_client_id and (s.not_after is null or s.not_after > clock_timestamp());
  if not found then raise exception 'MCP session is invalid.' using errcode = '42501'; end if;
  insert into public.connection_grants (owner_id, client_id, provider_session_id, permissions)
    values (v_owner_id, v_client_id::text, v_session_id::text, array['read_examples','read_profiles','write_profiles'])
    on conflict (owner_id, client_id, provider_session_id) do nothing;
  select * into connection from public.connection_grants g where g.owner_id = v_owner_id
    and g.client_id = v_client_id::text and g.provider_session_id = v_session_id::text;
  if connection.revoked_at is not null or (connection.expires_at is not null and connection.expires_at <= clock_timestamp()) then
    raise exception 'MCP connection is revoked or expired.' using errcode = '42501';
  end if;
  return jsonb_build_object('claims', jsonb_set(claims, '{aud}', to_jsonb(registration.resource_url)));
end;
$$;
revoke all on function public.mcp_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mcp_access_token_hook(jsonb) to supabase_auth_admin;

create or replace function public.resolve_mcp_connection(p_owner_id uuid, p_client_id uuid, p_session_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id, 'owner_id', g.owner_id, 'client_id', g.client_id,
    'provider_session_id', g.provider_session_id,
    'permissions', (select jsonb_agg(distinct p order by p) from unnest(g.permissions) p)
  ) from public.connection_grants g
  join auth.sessions s on s.id = p_session_id and s.user_id = g.owner_id and s.oauth_client_id = p_client_id
  join auth.oauth_clients c on c.id = s.oauth_client_id and c.deleted_at is null
  join auth.users u on u.id = g.owner_id
  join public.mcp_oauth_clients r on r.client_id = p_client_id and r.active
  join public.mcp_oauth_consents a on a.client_id = p_client_id and a.owner_id = g.owner_id and a.revoked_at is null
  where g.owner_id = p_owner_id and g.client_id = p_client_id::text and g.provider_session_id = p_session_id::text
    and g.revoked_at is null and (g.expires_at is null or g.expires_at > clock_timestamp())
    and (s.not_after is null or s.not_after > clock_timestamp())
    and (u.banned_until is null or u.banned_until <= clock_timestamp());
$$;

create or replace function public.revoke_mcp_connection(p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target_client text;
begin
  if actor is null or not coalesce(public.is_web_owner(actor), false) then
    raise exception 'A web session is required.' using errcode = '42501';
  end if;
  select g.client_id into target_client from public.connection_grants g where g.id = p_connection_id and g.owner_id = actor;
  if not found then return false; end if;
  -- Lock consent before grants, matching token issuance
  update public.mcp_oauth_consents set revoked_at = coalesce(revoked_at, clock_timestamp())
    where owner_id = actor and client_id::text = target_client;
  update public.connection_grants set revoked_at = coalesce(revoked_at, clock_timestamp())
    where owner_id = actor and client_id = target_client;
  return true;
end;
$$;

commit;
