begin;

alter table public.profile_drafts add column change_reason text check (length(change_reason) between 1 and 1000);
alter table public.profile_drafts add column changes jsonb;
alter table public.profile_drafts add column restored_from_version_id uuid;
alter table public.profile_drafts add constraint drafts_restored_version_fk foreign key (restored_from_version_id,profile_id,owner_id)
  references public.profile_versions(id,profile_id,owner_id);
alter table public.profile_versions add column change_reason text check (length(change_reason) between 1 and 1000);
alter table public.profile_versions add column restored_from_version_id uuid;
alter table public.profile_versions add constraint versions_restored_version_fk foreign key (restored_from_version_id,profile_id,owner_id)
  references public.profile_versions(id,profile_id,owner_id) deferrable initially deferred;

alter function public.profile_draft_result(public.profile_drafts) rename to profile_draft_result_v1;
create function public.profile_draft_result(p_draft public.profile_drafts)
returns jsonb language sql stable set search_path = '' as $$
  select public.profile_draft_result_v1(p_draft) || jsonb_build_object(
    'profileId', p_draft.profile_id, 'baseVersionId', p_draft.base_version_id,
    'changeReason', p_draft.change_reason, 'changes', p_draft.changes, 'restoredFromVersionId', p_draft.restored_from_version_id
  ) || case when p_draft.base_version_id is null then '{}'::jsonb else jsonb_build_object(
    'draftHash', encode(sha256(convert_to(jsonb_build_object('payload',p_draft.payload,'preview',p_draft.preview,
      'profileId',p_draft.profile_id,'baseVersionId',p_draft.base_version_id,'reason',p_draft.change_reason,
      'changes',p_draft.changes,'restoredFromVersionId',p_draft.restored_from_version_id)::text,'UTF8')),'hex')
  ) end;
$$;
alter function public.profile_version_result(uuid,uuid) rename to profile_version_result_v1;
create function public.profile_version_result(p_owner_id uuid,p_version_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select public.profile_version_result_v1(p_owner_id,p_version_id) || jsonb_build_object(
    'changeReason',v.change_reason,'restoredFromVersionId',v.restored_from_version_id
  ) from public.profile_versions v where v.id=p_version_id and v.owner_id=p_owner_id;
$$;

create function public.profile_payload_changes(p_before jsonb,p_after jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'fields',coalesce((select jsonb_agg(key order by key) from jsonb_object_keys(p_after) key
      where key not in ('rules','evidence') and p_before->key is distinct from p_after->key),'[]'::jsonb),
    'rulesAdded',coalesce((select jsonb_agg(rule->>'id' order by rule->>'id') from jsonb_array_elements(p_after->'rules') rule
      where not exists(select 1 from jsonb_array_elements(p_before->'rules') old where old->>'id'=rule->>'id')),'[]'::jsonb),
    'rulesRemoved',coalesce((select jsonb_agg(rule->>'id' order by rule->>'id') from jsonb_array_elements(p_before->'rules') rule
      where not exists(select 1 from jsonb_array_elements(p_after->'rules') newer where newer->>'id'=rule->>'id')),'[]'::jsonb),
    'rulesChanged',coalesce((select jsonb_agg(rule->>'id' order by rule->>'id') from jsonb_array_elements(p_after->'rules') rule
      where exists(select 1 from jsonb_array_elements(p_before->'rules') old where old->>'id'=rule->>'id' and old<>rule)),'[]'::jsonb),
    'evidenceChanged',p_before->'evidence' is distinct from p_after->'evidence'
  );
$$;

create function public.propose_mcp_profile_update(
  p_owner_id uuid,p_client_id uuid,p_session_id uuid,p_draft_id uuid,p_profile_id uuid,p_base_version_id uuid,
  p_payload jsonb,p_preview text,p_reason text,p_restored_from_version_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  connection jsonb;
  existing public.profile_drafts;
  current_profile public.profiles;
  base public.profile_versions;
  target_payload jsonb;
  result public.profile_drafts;
begin
  perform 1 from public.mcp_oauth_consents where owner_id=p_owner_id and client_id=p_client_id for share;
  perform 1 from public.connection_grants where owner_id=p_owner_id and client_id=p_client_id::text and provider_session_id=p_session_id::text for share;
  connection:=public.resolve_mcp_connection(p_owner_id,p_client_id,p_session_id);
  if connection is null or not(connection->'permissions' ? 'read_profiles') or not(connection->'permissions' ? 'write_profiles') then
    raise exception using errcode='42501',message='permission_denied';
  end if;
  if p_draft_id is null or p_profile_id is null or p_base_version_id is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode='22023',message='invalid_request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_draft_id::text,0));
  select * into existing from public.profile_drafts where id=p_draft_id;
  if found then
    if existing.owner_id<>p_owner_id or existing.profile_id is distinct from p_profile_id
      or existing.base_version_id is distinct from p_base_version_id or existing.payload<>p_payload or existing.preview<>p_preview
      or existing.change_reason is distinct from p_reason or existing.restored_from_version_id is distinct from p_restored_from_version_id then
      raise exception using errcode='23505',message='draft_conflict';
    end if;
    return public.profile_draft_result(existing);
  end if;
  select * into current_profile from public.profiles where id=p_profile_id and owner_id=p_owner_id and archived_at is null for share;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if current_profile.active_version_id is distinct from p_base_version_id then raise exception using errcode='22023',message='version_conflict'; end if;
  select * into base from public.profile_versions where id=p_base_version_id and profile_id=p_profile_id and owner_id=p_owner_id;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  if p_restored_from_version_id is not null then
    select payload into target_payload from public.profile_versions where id=p_restored_from_version_id and profile_id=p_profile_id and owner_id=p_owner_id;
    if not found then raise exception using errcode='P0002',message='not_found'; end if;
    if target_payload is distinct from p_payload then raise exception using errcode='22023',message='invalid_draft'; end if;
  end if;
  if base.payload=p_payload then raise exception using errcode='22023',message='no_changes'; end if;
  perform public.create_mcp_profile_draft(p_owner_id,p_client_id,p_session_id,p_draft_id,p_payload,p_preview);
  update public.profile_drafts set profile_id=p_profile_id,base_version_id=p_base_version_id,change_reason=p_reason,
    changes=public.profile_payload_changes(base.payload,p_payload),restored_from_version_id=p_restored_from_version_id
    where id=p_draft_id and owner_id=p_owner_id returning * into result;
  return public.profile_draft_result(result);
end;
$$;

create function public.get_mcp_profile_version(p_owner_id uuid,p_client_id uuid,p_session_id uuid,p_profile_id uuid,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare connection jsonb;
begin
  connection:=public.resolve_mcp_connection(p_owner_id,p_client_id,p_session_id);
  if connection is null or not(connection->'permissions' ? 'read_profiles') then raise exception using errcode='42501',message='permission_denied'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id and owner_id=p_owner_id and archived_at is null)
    or not exists(select 1 from public.profile_versions where id=p_version_id and profile_id=p_profile_id and owner_id=p_owner_id) then return null; end if;
  return public.profile_version_result(p_owner_id,p_version_id);
end;
$$;

create function public.list_mcp_profile_versions(p_owner_id uuid,p_client_id uuid,p_session_id uuid,p_profile_id uuid,p_before integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare connection jsonb; result jsonb;
begin
  connection:=public.resolve_mcp_connection(p_owner_id,p_client_id,p_session_id);
  if connection is null or not(connection->'permissions' ? 'read_profiles') then raise exception using errcode='42501',message='permission_denied'; end if;
  if p_before is not null and p_before<1 then raise exception using errcode='22023',message='invalid_request'; end if;
  if not exists(select 1 from public.profiles where id=p_profile_id and owner_id=p_owner_id and archived_at is null) then
    raise exception using errcode='P0002',message='not_found';
  end if;
  select jsonb_build_object('items',coalesce(jsonb_agg(item order by number desc) filter(where ordinal<=20),'[]'::jsonb),
    'nextBefore',case when count(*)>20 then min(number) filter(where ordinal<=20) else null end) into result from (
    select jsonb_build_object('versionId',id,'versionNumber',version_number,'approvedAt',approved_at,'approvalChannel',approval_channel,
      'changeReason',change_reason,'restoredFromVersionId',restored_from_version_id) item,version_number number,
      row_number() over(order by version_number desc) ordinal from public.profile_versions
    where owner_id=p_owner_id and profile_id=p_profile_id and (p_before is null or version_number<p_before)
    order by version_number desc limit 21
  ) page;
  return result;
end;
$$;

create or replace function public.save_mcp_profile_version(
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
  current_profile public.profiles;
  next_number integer := 1;
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
  select * into draft from public.profile_drafts where id = p_draft_id and owner_id = p_owner_id;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  if draft.base_version_id is not null then
    select * into current_profile from public.profiles where id=draft.profile_id and owner_id=p_owner_id and archived_at is null for update;
    if not found then raise exception using errcode='P0002',message='not_found'; end if;
  end if;
  select * into draft from public.profile_drafts where id = p_draft_id and owner_id = p_owner_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'not_found'; end if;
  actual_hash := public.profile_draft_result(draft)->>'draftHash';
  if actual_hash <> p_draft_hash then raise exception using errcode = '22023', message = 'draft_changed'; end if;
  if draft.status <> 'pending_review' or (draft.profile_id is not null and draft.base_version_id is null) then
    raise exception using errcode = '22023', message = 'draft_not_pending';
  end if;
  if draft.base_version_id is not null then
    if current_profile.id is distinct from draft.profile_id or current_profile.active_version_id is distinct from draft.base_version_id then
      raise exception using errcode='22023',message='version_conflict';
    end if;
    new_profile_id:=current_profile.id;
    select coalesce(max(version_number),0)+1 into next_number from public.profile_versions where profile_id=new_profile_id and owner_id=p_owner_id;
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
  if draft.base_version_id is null then
    insert into public.profiles (owner_id, name, description)
      values (p_owner_id, draft.payload->>'name', draft.payload->>'description') returning id into new_profile_id;
  end if;
  insert into public.profile_versions (owner_id, profile_id, version_number, payload, approval_channel, approved_by,change_reason,restored_from_version_id)
    values (p_owner_id, new_profile_id, next_number, draft.payload, 'chat', p_owner_id,draft.change_reason,draft.restored_from_version_id) returning id into new_version_id;
  insert into public.profile_sources (owner_id, version_id, rule_id, document_id, section_id, extraction_version, excerpt)
    select p_owner_id, new_version_id, item->>'ruleId', (item->>'documentId')::uuid,
      (item->>'sectionId')::uuid, (item->>'extractionVersion')::integer, item->>'excerpt'
    from jsonb_array_elements(draft.payload->'evidence') item;
  update public.profiles set name=draft.payload->>'name',description=draft.payload->>'description',active_version_id = new_version_id where id = new_profile_id and owner_id = p_owner_id;
  update public.profile_drafts set status = 'published', profile_id = new_profile_id where id = p_draft_id and owner_id = p_owner_id;
  insert into public.profile_mutations (owner_id, grant_id, idempotency_key, request_hash, draft_hash, resulting_version_id, draft_id)
    values (p_owner_id, (connection->>'id')::uuid, p_idempotency_key::text, request_hash, actual_hash, new_version_id, p_draft_id);
  insert into public.audit_events (owner_id, grant_id, action, target_id, request_id)
    values (p_owner_id, (connection->>'id')::uuid, 'save_profile_version', new_version_id, p_idempotency_key);
  return jsonb_build_object('draftId', p_draft_id, 'draftHash', actual_hash, 'profile', public.profile_version_result(p_owner_id, new_version_id));
end;
$$;

create function public.rollback_mcp_profile(p_owner_id uuid,p_client_id uuid,p_session_id uuid,p_profile_id uuid,
  p_target_version_id uuid,p_base_version_id uuid,p_reason text,p_idempotency_key uuid,p_approval text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare target jsonb; proposal jsonb; connection jsonb;
begin
  if p_idempotency_key is null or p_approval is distinct from 'user_requested' then raise exception using errcode='22023',message='invalid_request'; end if;
  perform 1 from public.mcp_oauth_consents where owner_id=p_owner_id and client_id=p_client_id for share;
  perform 1 from public.connection_grants where owner_id=p_owner_id and client_id=p_client_id::text and provider_session_id=p_session_id::text for share;
  connection:=public.resolve_mcp_connection(p_owner_id,p_client_id,p_session_id);
  if connection is null or not(connection->'permissions' ? 'read_profiles') or not(connection->'permissions' ? 'write_profiles') then
    raise exception using errcode='42501',message='permission_denied';
  end if;
  -- Serialize before taking the profile lock to avoid shared-lock upgrades between rollbacks
  perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text||':'||p_idempotency_key::text,0));
  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text,0));
  perform 1 from public.profiles where id=p_profile_id and owner_id=p_owner_id and archived_at is null for update;
  if not found then raise exception using errcode='P0002',message='not_found'; end if;
  target:=public.get_mcp_profile_version(p_owner_id,p_client_id,p_session_id,p_profile_id,p_target_version_id);
  if target is null then raise exception using errcode='P0002',message='not_found'; end if;
  proposal:=public.propose_mcp_profile_update(p_owner_id,p_client_id,p_session_id,p_idempotency_key,p_profile_id,p_base_version_id,
    target->'payload','Rollback to version '||(target->>'versionNumber'),p_reason,p_target_version_id);
  return public.save_mcp_profile_version(p_owner_id,p_client_id,p_session_id,p_idempotency_key,proposal->>'draftHash',p_idempotency_key,p_approval);
end;
$$;

revoke all on function public.profile_draft_result(public.profile_drafts),public.profile_version_result(uuid,uuid),public.profile_payload_changes(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.propose_mcp_profile_update(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,uuid),
  public.get_mcp_profile_version(uuid,uuid,uuid,uuid,uuid),public.list_mcp_profile_versions(uuid,uuid,uuid,uuid,integer),
  public.rollback_mcp_profile(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.propose_mcp_profile_update(uuid,uuid,uuid,uuid,uuid,uuid,jsonb,text,text,uuid),
  public.get_mcp_profile_version(uuid,uuid,uuid,uuid,uuid),public.list_mcp_profile_versions(uuid,uuid,uuid,uuid,integer),
  public.rollback_mcp_profile(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text) to service_role;

commit;
