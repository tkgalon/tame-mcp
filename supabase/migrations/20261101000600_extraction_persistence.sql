begin;

create function public.validate_document_extraction(p_result jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  section jsonb;
  ordinal integer := 0;
  next_offset integer := 0;
  character_count integer := 0;
  content text;
  utf16_length integer;
  section_keys text[] := array['ordinal', 'heading', 'page', 'content', 'sourceStart', 'sourceEnd'];
begin
  if jsonb_typeof(p_result) is distinct from 'object'
    or octet_length(p_result::text) > 4194304 then
    raise exception 'Invalid extraction result.' using errcode = '22023';
  end if;
  if not coalesce(
    p_result - array['status', 'contentHash', 'parserVersion', 'warnings', 'sections', 'errorCode'] = '{}'::jsonb
    and jsonb_typeof(p_result -> 'status') = 'string'
    and p_result ->> 'status' in ('ready', 'failed', 'needs_ocr', 'unsupported')
    and jsonb_typeof(p_result -> 'contentHash') = 'string'
    and p_result ->> 'contentHash' ~ '^[a-f0-9]{64}$'
    and jsonb_typeof(p_result -> 'parserVersion') = 'string'
    and length(p_result ->> 'parserVersion') between 1 and 100
    and length(btrim(p_result ->> 'parserVersion')) > 0
    and jsonb_typeof(p_result -> 'warnings') = 'array', false) then
    raise exception 'Invalid extraction metadata.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_result -> 'warnings') > 10 or exists (
    select 1 from jsonb_array_elements(p_result -> 'warnings') w
    where jsonb_typeof(w) <> 'string' or w #>> '{}' not in (
      'section_split', 'heading_shortened', 'images_not_extracted', 'html_preserved',
      'layout_approximate', 'pages_without_text', 'conversion_warning'
    )
  ) then
    raise exception 'Invalid extraction warnings.' using errcode = '22023';
  end if;

  if p_result ->> 'status' <> 'ready' then
    if p_result ? 'sections' or not coalesce(jsonb_typeof(p_result -> 'errorCode') = 'string' and (
      (p_result ->> 'status' = 'needs_ocr' and p_result ->> 'errorCode' = 'no_extractable_text')
      or (p_result ->> 'status' = 'unsupported' and p_result ->> 'errorCode' = 'unsupported_media_type')
      or (p_result ->> 'status' = 'failed' and p_result ->> 'errorCode' in (
        'empty_document', 'file_too_large', 'invalid_utf8', 'binary_content', 'format_mismatch',
        'text_limit_exceeded', 'section_limit_exceeded', 'parser_error', 'invalid_document',
        'password_required', 'archive_limit_exceeded', 'page_limit_exceeded',
        'invalid_text_content', 'complexity_limit_exceeded'
      ))
    ), false) then
      raise exception 'Invalid extraction failure.' using errcode = '22023';
    end if;
    return;
  end if;
  if p_result ? 'errorCode' or jsonb_typeof(p_result -> 'sections') is distinct from 'array' then
    raise exception 'Invalid extraction sections.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_result -> 'sections') not between 1 and 1000 then
    raise exception 'Invalid section count.' using errcode = '22023';
  end if;
  for section in select value from jsonb_array_elements(p_result -> 'sections') loop
    if jsonb_typeof(section) is distinct from 'object' then
      raise exception 'Invalid extraction section.' using errcode = '22023';
    end if;
    if not coalesce(section ?& section_keys and section - section_keys = '{}'::jsonb
      and jsonb_typeof(section -> 'ordinal') = 'number' and section ->> 'ordinal' = ordinal::text
      and jsonb_typeof(section -> 'content') = 'string'
      and jsonb_typeof(section -> 'sourceStart') = 'number' and section ->> 'sourceStart' = next_offset::text
      and jsonb_typeof(section -> 'sourceEnd') = 'number' and section ->> 'sourceEnd' ~ '^[1-9][0-9]{0,5}$'
      and (jsonb_typeof(section -> 'heading') = 'null'
        or (jsonb_typeof(section -> 'heading') = 'string' and length(section ->> 'heading') <= 500))
      and (jsonb_typeof(section -> 'page') = 'null'
        or (jsonb_typeof(section -> 'page') = 'number' and section ->> 'page' ~ '^[1-9][0-9]{0,9}$')),
      false) then
      raise exception 'Invalid extraction section metadata.' using errcode = '22023';
    end if;
    content := section ->> 'content';
    character_count := character_count + length(content);
    -- PostgreSQL counts code points, while parser source offsets use UTF-16 units
    utf16_length := length(content) + length(regexp_replace(content, U&'[^\+010000-\+10FFFF]', '', 'g'));
    if length(content) not between 1 and 8000 or character_count > 100000
      or (section ->> 'sourceEnd')::integer <> next_offset + utf16_length
      or (section ->> 'sourceEnd')::integer > 200000
      or (section ->> 'page')::bigint > 2147483647 then
      raise exception 'Extraction limits or offsets do not match.' using errcode = '22023';
    end if;
    next_offset := (section ->> 'sourceEnd')::integer;
    ordinal := ordinal + 1;
  end loop;
end;
$$;
revoke all on function public.validate_document_extraction(jsonb) from public, anon, authenticated;

create function public.finish_document_job(p_job_id uuid, p_lease_token uuid, p_result jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  document public.documents;
  document_id uuid;
begin
  select j.document_id into document_id from public.processing_jobs j where j.id = p_job_id;
  if not found then return false; end if;
  select * into document from public.documents d where d.id = document_id for update;
  if not found then return false; end if;
  select * into job from public.processing_jobs j where j.id = p_job_id for update;
  if not found or job.status <> 'running' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() or job.extraction_version <> document.extraction_version
    or document.status <> 'processing' then return false; end if;

  perform public.validate_document_extraction(p_result);
  if (job.content_hash is not null and job.content_hash <> p_result ->> 'contentHash')
    or (job.parser_version is not null and job.parser_version <> p_result ->> 'parserVersion') then
    raise exception 'Extraction does not match the job.' using errcode = '22023';
  end if;
  if job.lease_until <= clock_timestamp() then return false; end if;

  if p_result ->> 'status' = 'ready' then
    insert into public.document_sections (
      owner_id, document_id, extraction_version, ordinal, heading, page, content, source_start, source_end
    ) select document.owner_id, document.id, job.extraction_version,
      (s ->> 'ordinal')::integer, s ->> 'heading', (s ->> 'page')::integer,
      s ->> 'content', (s ->> 'sourceStart')::integer, (s ->> 'sourceEnd')::integer
      from jsonb_array_elements(p_result -> 'sections') s;
  end if;
  update public.documents set status = p_result ->> 'status', content_hash = p_result ->> 'contentHash',
    parser_version = p_result ->> 'parserVersion', warnings = p_result -> 'warnings',
    extraction_error_code = p_result ->> 'errorCode' where id = document.id;
  update public.processing_jobs set status = case when p_result ->> 'status' = 'failed' then 'failed' else 'succeeded' end,
    content_hash = p_result ->> 'contentHash', parser_version = p_result ->> 'parserVersion',
    error_code = p_result ->> 'errorCode', lease_token = null, lease_until = null where id = job.id;
  return true;
end;
$$;

revoke all on function public.finish_document_job(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_document_job(uuid, uuid, jsonb) to service_role;

commit;
