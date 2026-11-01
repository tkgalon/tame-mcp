begin;

-- Original bytes are hashed by the worker after downloading the registered object
alter table public.processing_jobs alter column content_hash drop not null;
alter table public.processing_jobs alter column parser_version drop not null;
alter table public.processing_jobs add column extraction_version integer not null default 1
  check (extraction_version > 0);
update public.processing_jobs j set extraction_version = d.extraction_version
  from public.documents d where d.id = j.document_id and d.owner_id = j.owner_id;
create unique index jobs_one_active_document_idx on public.processing_jobs(document_id)
  where status in ('queued', 'running');

alter table public.documents add column parser_version text
  check (length(parser_version) between 1 and 100 and length(btrim(parser_version)) > 0);
alter table public.documents add column extraction_error_code text
  check (length(extraction_error_code) between 1 and 100);
alter table public.document_sections add column source_start integer;
alter table public.document_sections add column source_end integer;
alter table public.document_sections add constraint sections_source_offsets_check check (
  (source_start is null and source_end is null)
  or (source_start is not null and source_end is not null
    and source_start >= 0 and source_end > source_start and source_end <= 200000)
);

create function public.enqueue_uploaded_document()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.processing_jobs (owner_id, document_id, extraction_version)
    values (new.owner_id, new.id, new.extraction_version)
    on conflict (document_id) where status in ('queued', 'running') do nothing;
  return new;
end;
$$;
create trigger documents_enqueue_upload
  after update of status on public.documents for each row
  when (old.status = 'uploading' and new.status = 'uploaded')
  execute function public.enqueue_uploaded_document();
revoke all on function public.enqueue_uploaded_document() from public, anon, authenticated;

-- Existing confirmed uploads also enter the queue without resetting processed documents
insert into public.processing_jobs (owner_id, document_id, extraction_version)
  select d.owner_id, d.id, d.extraction_version from public.documents d
  where d.status = 'uploaded'
    and not exists (select 1 from public.processing_jobs j where j.document_id = d.id)
  on conflict (document_id) where status in ('queued', 'running') do nothing;

create function public.claim_document_job(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  document public.documents;
  candidate_id uuid;
  sweep integer;
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
    raise exception 'Invalid lease duration.' using errcode = '22023';
  end if;
  for sweep in 1..20 loop
    select j.id into candidate_id from public.processing_jobs j
      join public.documents d on d.id = j.document_id and d.owner_id = j.owner_id
      where (j.status = 'queued' and j.next_run_at <= clock_timestamp())
        or (j.status = 'running' and j.lease_until <= clock_timestamp())
      order by j.next_run_at, j.created_at, j.id
      limit 1 for update of d, j skip locked;
    if not found then return null; end if;
    select * into job from public.processing_jobs where id = candidate_id;
    select * into document from public.documents where id = job.document_id;

    if job.extraction_version <> document.extraction_version
      or document.status not in ('uploaded', 'processing') then
      update public.processing_jobs set status = 'failed', error_code = 'job_superseded',
        lease_token = null, lease_until = null where id = job.id;
      continue;
    end if;
    if job.attempts >= 3 then
      update public.processing_jobs set status = 'failed', error_code = 'lease_expired',
        lease_token = null, lease_until = null where id = job.id;
      update public.documents set status = 'failed', extraction_error_code = 'lease_expired'
        where id = document.id;
      continue;
    end if;

    update public.processing_jobs set status = 'running', attempts = attempts + 1,
      lease_token = gen_random_uuid(), lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
      error_code = null where id = job.id returning * into job;
    update public.documents set status = 'processing', extraction_error_code = null where id = document.id;
    return to_jsonb(job) || jsonb_build_object('storage_path', document.storage_path,
      'media_type', document.media_type, 'size_bytes', document.size_bytes);
  end loop;
  return null;
end;
$$;

create function public.retry_document_job(p_job_id uuid, p_lease_token uuid, p_error_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  job public.processing_jobs;
  document public.documents;
  document_id uuid;
begin
  if p_error_code is null or p_error_code not in (
    'storage_unavailable', 'parser_timeout', 'parser_crashed', 'worker_error'
  ) then
    raise exception 'Invalid retry reason.' using errcode = '22023';
  end if;
  select j.document_id into document_id from public.processing_jobs j where j.id = p_job_id;
  if not found then return false; end if;
  -- Lock documents before jobs, matching upload confirmation and result persistence
  select * into document from public.documents d where d.id = document_id for update;
  if not found then return false; end if;
  select * into job from public.processing_jobs j where j.id = p_job_id for update;
  if not found or job.status <> 'running' or job.lease_token is distinct from p_lease_token
    or job.lease_until <= clock_timestamp() or job.extraction_version <> document.extraction_version
    or document.status <> 'processing' then return false; end if;

  update public.processing_jobs set status = case when attempts < 3 then 'queued' else 'failed' end,
    next_run_at = clock_timestamp() + make_interval(secs => 5 * power(2, attempts)::integer),
    error_code = p_error_code, lease_token = null, lease_until = null where id = job.id;
  update public.documents set status = case when job.attempts < 3 then 'uploaded' else 'failed' end,
    extraction_error_code = case when job.attempts < 3 then null else p_error_code end
    where id = document.id;
  return true;
end;
$$;

revoke all on function public.claim_document_job(integer) from public, anon, authenticated;
revoke all on function public.retry_document_job(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_document_job(integer) to service_role;
grant execute on function public.retry_document_job(uuid, uuid, text) to service_role;

commit;
