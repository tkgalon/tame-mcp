begin;

create function public.resolve_mcp_connection(p_owner_id uuid, p_client_id uuid, p_session_id uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', g.id, 'owner_id', g.owner_id, 'client_id', g.client_id,
    'provider_session_id', g.provider_session_id,
    'permissions', (select jsonb_agg(distinct p order by p) from unnest(g.permissions) p)
  )
  from public.connection_grants g
  join auth.sessions s on s.id = p_session_id and s.user_id = g.owner_id
    and s.oauth_client_id = p_client_id
  join auth.oauth_clients c on c.id = s.oauth_client_id and c.deleted_at is null
  join auth.users u on u.id = g.owner_id
  where g.owner_id = p_owner_id and g.client_id = p_client_id::text
    and g.provider_session_id = p_session_id::text and g.revoked_at is null
    and (g.expires_at is null or g.expires_at > clock_timestamp())
    and (s.not_after is null or s.not_after > clock_timestamp())
    and (u.banned_until is null or u.banned_until <= clock_timestamp());
$$;
revoke all on function public.resolve_mcp_connection(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.resolve_mcp_connection(uuid, uuid, uuid) to service_role;

create function public.revoke_mcp_connection(p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null or not coalesce(public.is_web_owner(actor), false) then
    raise exception 'A web session is required.' using errcode = '42501';
  end if;
  update public.connection_grants set revoked_at = coalesce(revoked_at, clock_timestamp())
    where id = p_connection_id and owner_id = actor;
  return found;
end;
$$;
revoke all on function public.revoke_mcp_connection(uuid) from public, anon, authenticated;
grant execute on function public.revoke_mcp_connection(uuid) to authenticated;

commit;
