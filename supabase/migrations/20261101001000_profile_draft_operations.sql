begin;

create function public.profile_draft_result(p_draft public.profile_drafts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_draft.id, 'status', p_draft.status, 'schemaVersion', p_draft.schema_version,
    'payload', p_draft.payload, 'preview', p_draft.preview, 'createdAt', p_draft.created_at,
    'draftHash', encode(sha256(convert_to(p_draft.payload::text || chr(10) || p_draft.preview, 'UTF8')), 'hex')
  );
$$;

-- Only the trusted MCP backend invokes these operations after full contract validation
create function public.create_mcp_profile_draft(
  p_owner_id uuid, p_client_id uuid, p_session_id uuid,
  p_draft_id uuid, p_payload jsonb, p_preview text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection jsonb;
  existing public.profile_drafts;
  saved public.profile_drafts;
  evidence jsonb;
  source_document public.documents;
  source_section public.document_sections;
begin
  -- Match the consent then grant lock order used by revocation
  perform 1 from public.mcp_oauth_consents
    where owner_id = p_owner_id and client_id = p_client_id for share;
  perform 1 from public.connection_grants
    where owner_id = p_owner_id and client_id = p_client_id::text
      and provider_session_id = p_session_id::text for share;
  connection := public.resolve_mcp_connection(p_owner_id, p_client_id, p_session_id);
  if connection is null or not (connection->'permissions' ? 'write_profiles') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  if p_draft_id is null or p_preview is null or length(p_preview) > 6000
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'schemaVersion' is distinct from '1'::jsonb
    or jsonb_typeof(p_payload->'rules') is distinct from 'array'
    or jsonb_typeof(p_payload->'evidence') is distinct from 'array'
    or octet_length(p_payload::text) + octet_length(p_preview) > 60000 then
    raise exception using errcode = '22023', message = 'invalid_draft';
  end if;
  if jsonb_array_length(p_payload->'rules') not between 1 and 20
    or jsonb_array_length(p_payload->'evidence') > 40 then
    raise exception using errcode = '22023', message = 'invalid_draft';
  end if;
  if jsonb_array_length(p_payload->'evidence') > 0 and not (connection->'permissions' ? 'read_examples') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;

  -- Serialize retries of the same draft without locking unrelated drafts
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text, 0));
  select * into existing from public.profile_drafts where id = p_draft_id;
  if found then
    if existing.owner_id <> p_owner_id or existing.payload <> p_payload or existing.preview <> p_preview then
      raise exception using errcode = '23505', message = 'draft_conflict';
    end if;
    return public.profile_draft_result(existing);
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_payload->'rules') rule
    where rule->>'origin' = 'inferred' and not exists (
      select 1 from jsonb_array_elements(p_payload->'evidence') item where item->>'ruleId' = rule->>'id'
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_evidence';
  end if;

  for evidence in select value from jsonb_array_elements(p_payload->'evidence')
    order by value->>'documentId', value->>'sectionId', value->>'ruleId'
  loop
    if jsonb_typeof(evidence->'excerpt') is distinct from 'string'
      or length(btrim(evidence->>'excerpt')) not between 1 and 1000
      or not exists (select 1 from jsonb_array_elements(p_payload->'rules') rule where rule->>'id' = evidence->>'ruleId') then
      raise exception using errcode = '22023', message = 'invalid_evidence';
    end if;
    select * into source_document from public.documents
      where id = (evidence->>'documentId')::uuid and owner_id = p_owner_id for share;
    if not found then
      raise exception using errcode = '22023', message = 'invalid_evidence';
    end if;
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

  insert into public.profile_drafts (id, owner_id, payload, preview)
    values (p_draft_id, p_owner_id, p_payload, p_preview) returning * into saved;
  insert into public.profile_sources (owner_id, draft_id, rule_id, document_id, section_id, extraction_version, excerpt)
    select p_owner_id, saved.id, item->>'ruleId', (item->>'documentId')::uuid,
      (item->>'sectionId')::uuid, (item->>'extractionVersion')::integer, item->>'excerpt'
    from jsonb_array_elements(p_payload->'evidence') item;
  insert into public.audit_events (owner_id, grant_id, action, target_id, request_id)
    values (p_owner_id, (connection->>'id')::uuid, 'create_profile_draft', saved.id, p_draft_id);
  return public.profile_draft_result(saved);
end;
$$;

create function public.get_mcp_profile_draft(p_owner_id uuid, p_client_id uuid, p_session_id uuid, p_draft_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  connection jsonb;
  draft public.profile_drafts;
begin
  connection := public.resolve_mcp_connection(p_owner_id, p_client_id, p_session_id);
  if connection is null or not (connection->'permissions' ? 'read_profiles') then
    raise exception using errcode = '42501', message = 'permission_denied';
  end if;
  select * into draft from public.profile_drafts where id = p_draft_id and owner_id = p_owner_id;
  if not found then return null; end if;
  return public.profile_draft_result(draft);
end;
$$;

revoke all on function public.profile_draft_result(public.profile_drafts) from public, anon, authenticated, service_role;
revoke all on function public.create_mcp_profile_draft(uuid,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.get_mcp_profile_draft(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_mcp_profile_draft(uuid,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.get_mcp_profile_draft(uuid,uuid,uuid,uuid) to service_role;

commit;
