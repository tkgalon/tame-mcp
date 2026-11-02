begin;

alter table public.profile_mutations add column draft_id uuid;
alter table public.profile_mutations add constraint mutations_draft_fk
  foreign key (draft_id, owner_id) references public.profile_drafts(id, owner_id) on delete set null (draft_id);
alter table public.profile_mutations add constraint mutations_draft_unique unique (owner_id, draft_id);

create function public.profile_version_result(p_owner_id uuid, p_version_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', v.profile_id, 'name', v.payload->>'name', 'description', v.payload->>'description',
    'versionId', v.id, 'versionNumber', v.version_number, 'approvedAt', v.approved_at,
    'schemaVersion', v.schema_version, 'payload', v.payload, 'approvalChannel', v.approval_channel,
    'evidenceStatus', coalesce((
      select jsonb_agg(jsonb_build_object(
        'ruleId', item.value->>'ruleId', 'documentId', item.value->>'documentId', 'sectionId', item.value->>'sectionId',
        'status', case when d.id is null or s.id is null then 'unavailable'
          when d.status <> 'ready' or d.extraction_version <> (item.value->>'extractionVersion')::integer
            or strpos(s.content, item.value->>'excerpt') = 0 then 'changed' else 'available' end
      ) order by item.ordinality)
      from jsonb_array_elements(v.payload->'evidence') with ordinality item(value, ordinality)
      left join public.documents d on d.id = (item.value->>'documentId')::uuid and d.owner_id = p_owner_id
      left join public.document_sections s on s.id = (item.value->>'sectionId')::uuid
        and s.document_id = d.id and s.owner_id = p_owner_id
        and s.extraction_version = (item.value->>'extractionVersion')::integer
    ), '[]'::jsonb)
  ) from public.profile_versions v where v.id = p_version_id and v.owner_id = p_owner_id;
$$;

create function public.save_mcp_profile_version(
  p_owner_id uuid, p_client_id uuid, p_session_id uuid,
  p_draft_id uuid, p_draft_hash text, p_idempotency_key uuid, p_approval text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  connection jsonb;
  draft public.profile_drafts;
  mutation public.profile_mutations;
  request_hash text;
  actual_hash text;
  new_profile_id uuid;
  new_version_id uuid;
  evidence jsonb;
  source_document public.documents;
  source_section public.document_sections;
begin
  perform 1 from public.mcp_oauth_consents where owner_id = p_owner_id and client_id = p_client_id for share;
  perform 1 from public.connection_grants where owner_id = p_owner_id and client_id = p_client_id::text
    and provider_session_id = p_session_id::text for share;
  connection := public.resolve_mcp_connection(p_owner_id, p_client_id, p_session_id);
  if connection is null or not (connection->'permissions' ? 'write_profiles') or not (connection->'permissions' ? 'read_profiles') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  if p_draft_id is null or p_idempotency_key is null or p_approval is distinct from 'user_requested'
    or p_draft_hash is null or p_draft_hash !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  request_hash := encode(sha256(convert_to(jsonb_build_object(
    'draftId', p_draft_id, 'draftHash', p_draft_hash, 'approval', p_approval
  )::text, 'UTF8')), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':' || p_idempotency_key::text, 0));
  select * into mutation from public.profile_mutations where owner_id = p_owner_id and idempotency_key = p_idempotency_key::text;
  if found then
    if mutation.request_hash <> request_hash then
      raise exception using errcode = '23505', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('draftId', p_draft_id, 'draftHash', mutation.draft_hash,
      'profile', public.profile_version_result(p_owner_id, mutation.resulting_version_id));
  end if;
  select * into draft from public.profile_drafts where id = p_draft_id and owner_id = p_owner_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  actual_hash := public.profile_draft_result(draft)->>'draftHash';
  if actual_hash <> p_draft_hash then raise exception using errcode = '22023', message = 'draft_changed'; end if;
  if draft.status <> 'pending_review' or draft.profile_id is not null or draft.base_version_id is not null then
    raise exception using errcode = '22023', message = 'draft_not_pending';
  end if;
  if draft.schema_version <> 1 or draft.payload->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(draft.payload->'rules') is distinct from 'array'
    or jsonb_typeof(draft.payload->'evidence') is distinct from 'array'
    or length(btrim(draft.payload->>'name')) not between 1 and 120
    or length(draft.payload->>'description') > 2000 then
    raise exception using errcode = '22023', message = 'invalid_draft';
  end if;
  if jsonb_array_length(draft.payload->'evidence') > 0 and not (connection->'permissions' ? 'read_examples') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  -- Lock sources through publication so a concurrent extraction cannot invalidate checked evidence
  for evidence in select value from jsonb_array_elements(draft.payload->'evidence')
    order by value->>'documentId', value->>'sectionId', value->>'ruleId'
  loop
    select * into source_document from public.documents
      where id = (evidence->>'documentId')::uuid and owner_id = p_owner_id for share;
    if not found then raise exception using errcode = '22023', message = 'invalid_evidence'; end if;
    if source_document.status <> 'ready' or source_document.extraction_version <> (evidence->>'extractionVersion')::integer then
      raise exception using errcode = '22023', message = 'invalid_evidence';
    end if;
    select * into source_section from public.document_sections
      where id = (evidence->>'sectionId')::uuid and document_id = source_document.id
        and owner_id = p_owner_id and extraction_version = source_document.extraction_version for share;
    if not found or strpos(source_section.content, evidence->>'excerpt') = 0 then
      raise exception using errcode = '22023', message = 'invalid_evidence';
    end if;
  end loop;
  insert into public.profiles (owner_id, name, description)
    values (p_owner_id, draft.payload->>'name', draft.payload->>'description') returning id into new_profile_id;
  insert into public.profile_versions (owner_id, profile_id, version_number, payload, approval_channel, approved_by)
    values (p_owner_id, new_profile_id, 1, draft.payload, 'chat', p_owner_id) returning id into new_version_id;
  insert into public.profile_sources (owner_id, version_id, rule_id, document_id, section_id, extraction_version, excerpt)
    select p_owner_id, new_version_id, item->>'ruleId', (item->>'documentId')::uuid,
      (item->>'sectionId')::uuid, (item->>'extractionVersion')::integer, item->>'excerpt'
    from jsonb_array_elements(draft.payload->'evidence') item;
  update public.profiles set active_version_id = new_version_id where id = new_profile_id and owner_id = p_owner_id;
  update public.profile_drafts set status = 'published', profile_id = new_profile_id where id = p_draft_id and owner_id = p_owner_id;
  insert into public.profile_mutations (owner_id, grant_id, idempotency_key, request_hash, draft_hash, resulting_version_id, draft_id)
    values (p_owner_id, (connection->>'id')::uuid, p_idempotency_key::text, request_hash, actual_hash, new_version_id, p_draft_id);
  insert into public.audit_events (owner_id, grant_id, action, target_id, request_id)
    values (p_owner_id, (connection->>'id')::uuid, 'save_profile_version', new_version_id, p_idempotency_key);
  return jsonb_build_object('draftId', p_draft_id, 'draftHash', actual_hash, 'profile', public.profile_version_result(p_owner_id, new_version_id));
end;
$$;

create function public.find_mcp_profiles(p_owner_id uuid, p_client_id uuid, p_session_id uuid, p_query text default '', p_page integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  connection jsonb;
  result jsonb;
begin
  connection := public.resolve_mcp_connection(p_owner_id, p_client_id, p_session_id);
  if connection is null or not (connection->'permissions' ? 'read_profiles') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  if p_query is null or length(p_query) > 120 or p_page is null or p_page not between 1 and 10000 then
    raise exception using errcode = '22023', message = 'invalid_request';
  end if;
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(item order by ordinal) filter (where ordinal <= p_page * 20), '[]'::jsonb),
    'nextPage', case when count(*) > 20 and p_page < 10000 then p_page + 1 else null end
  ) into result from (
    select jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description,
      'versionId', v.id, 'versionNumber', v.version_number, 'approvedAt', v.approved_at) item,
      row_number() over (order by lower(p.name), p.id) ordinal
    from public.profiles p join public.profile_versions v on v.id = p.active_version_id and v.owner_id = p.owner_id and v.profile_id = p.id
    where p.owner_id = p_owner_id and p.archived_at is null
      and (strpos(lower(p.name), lower(p_query)) > 0 or strpos(lower(p.description), lower(p_query)) > 0)
    order by lower(p.name), p.id offset ((p_page - 1) * 20) limit 21
  ) page;
  return result;
end;
$$;

create function public.get_mcp_profile(p_owner_id uuid, p_client_id uuid, p_session_id uuid, p_profile_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  connection jsonb;
  version_id uuid;
begin
  connection := public.resolve_mcp_connection(p_owner_id, p_client_id, p_session_id);
  if connection is null or not (connection->'permissions' ? 'read_profiles') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  select active_version_id into version_id from public.profiles
    where id = p_profile_id and owner_id = p_owner_id and archived_at is null;
  if version_id is null then return null; end if;
  return public.profile_version_result(p_owner_id, version_id);
end;
$$;

revoke all on function public.profile_version_result(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.save_mcp_profile_version(uuid,uuid,uuid,uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.find_mcp_profiles(uuid,uuid,uuid,text,integer) from public, anon, authenticated;
revoke all on function public.get_mcp_profile(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.save_mcp_profile_version(uuid,uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.find_mcp_profiles(uuid,uuid,uuid,text,integer) to service_role;
grant execute on function public.get_mcp_profile(uuid,uuid,uuid,uuid) to service_role;

commit;
