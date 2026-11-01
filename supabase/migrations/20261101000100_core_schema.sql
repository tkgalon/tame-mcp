begin;

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  collection_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 255),
  media_type text not null check (media_type in (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  )),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  extraction_version integer not null default 1 check (extraction_version > 0),
  status text not null default 'uploading' check (status in (
    'uploading', 'uploaded', 'processing', 'ready', 'needs_ocr', 'unsupported', 'failed'
  )),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (collection_id, owner_id) references public.collections(id, owner_id) on delete cascade,
  check (storage_path = owner_id::text || '/' || id::text || '/original')
);

create table public.document_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  extraction_version integer not null check (extraction_version > 0),
  ordinal integer not null check (ordinal >= 0),
  page integer check (page > 0),
  heading text,
  content text not null check (length(content) between 1 and 100000),
  unique (id, owner_id),
  unique (id, document_id, owner_id, extraction_version),
  unique (document_id, extraction_version, ordinal),
  foreign key (document_id, owner_id) references public.documents(id, owner_id) on delete cascade
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  active_version_id uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.profile_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null,
  version_number integer not null check (version_number > 0),
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb),
  approval_channel text not null check (approval_channel in ('chat', 'web')),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (id, profile_id, owner_id),
  unique (profile_id, version_number),
  foreign key (profile_id, owner_id) references public.profiles(id, owner_id) on delete cascade,
  check (approved_by = owner_id)
);

alter table public.profiles add constraint profiles_active_version_fk
  foreign key (active_version_id, id, owner_id)
  references public.profile_versions(id, profile_id, owner_id)
  deferrable initially deferred;

create table public.profile_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid,
  base_version_id uuid,
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload <> '{}'::jsonb),
  preview text not null default '' check (length(preview) <= 20000),
  status text not null default 'pending_review' check (status in ('pending_review', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  foreign key (profile_id, owner_id) references public.profiles(id, owner_id) on delete cascade,
  foreign key (base_version_id, profile_id, owner_id)
    references public.profile_versions(id, profile_id, owner_id),
  check (base_version_id is null or profile_id is not null)
);

create table public.profile_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  draft_id uuid,
  version_id uuid,
  rule_id text not null check (length(btrim(rule_id)) between 1 and 120),
  document_id uuid,
  section_id uuid,
  extraction_version integer not null check (extraction_version > 0),
  excerpt text not null check (length(excerpt) between 1 and 4000),
  foreign key (draft_id, owner_id) references public.profile_drafts(id, owner_id) on delete cascade,
  foreign key (version_id, owner_id) references public.profile_versions(id, owner_id) on delete cascade,
  foreign key (document_id, owner_id) references public.documents(id, owner_id)
    on delete set null (document_id),
  foreign key (section_id, document_id, owner_id, extraction_version)
    references public.document_sections(id, document_id, owner_id, extraction_version) on delete set null (section_id),
  check (num_nonnulls(draft_id, version_id) = 1),
  check (section_id is null or document_id is not null)
);

create table public.connection_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null check (length(btrim(client_id)) between 1 and 255),
  provider_session_id text not null check (length(btrim(provider_session_id)) between 1 and 255),
  permissions text[] not null check (
    cardinality(permissions) > 0
    and array_position(permissions, null) is null
    and permissions <@ array['read_profiles', 'read_examples', 'write_profiles']::text[]
  ),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, owner_id),
  unique (owner_id, client_id, provider_session_id),
  check (expires_at is null or expires_at > created_at)
);

create table public.profile_mutations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid,
  idempotency_key text not null check (length(btrim(idempotency_key)) between 1 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  draft_hash text not null check (draft_hash ~ '^[a-f0-9]{64}$'),
  resulting_version_id uuid not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key),
  foreign key (grant_id, owner_id) references public.connection_grants(id, owner_id)
    on delete set null (grant_id),
  foreign key (resulting_version_id, owner_id) references public.profile_versions(id, owner_id) on delete cascade
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null,
  parser_version text not null check (length(btrim(parser_version)) between 1 and 100),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_run_at timestamptz not null default now(),
  error_code text check (length(error_code) <= 100),
  created_at timestamptz not null default now(),
  foreign key (document_id, owner_id) references public.documents(id, owner_id) on delete cascade,
  unique (document_id, content_hash, parser_version),
  check (
    (status = 'running' and lease_token is not null and lease_until is not null)
    or (status <> 'running' and lease_token is null and lease_until is null)
  )
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  grant_id uuid,
  action text not null check (length(btrim(action)) between 1 and 100),
  target_id uuid,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (grant_id, owner_id) references public.connection_grants(id, owner_id)
    on delete set null (grant_id)
);

create index collections_owner_idx on public.collections(owner_id);
create index documents_collection_idx on public.documents(collection_id, owner_id);
create index sections_document_idx on public.document_sections(document_id, owner_id);
create index profiles_owner_idx on public.profiles(owner_id);
create index profiles_active_version_idx on public.profiles(active_version_id);
create index drafts_owner_idx on public.profile_drafts(owner_id, created_at desc);
create index drafts_profile_idx on public.profile_drafts(profile_id, owner_id);
create index drafts_base_version_idx on public.profile_drafts(base_version_id);
create index versions_profile_idx on public.profile_versions(profile_id, owner_id);
create index sources_draft_idx on public.profile_sources(draft_id, owner_id);
create index sources_version_idx on public.profile_sources(version_id, owner_id);
create index sources_document_idx on public.profile_sources(document_id, owner_id);
create index sources_section_idx on public.profile_sources(section_id);
create index grants_owner_idx on public.connection_grants(owner_id);
create index mutations_version_idx on public.profile_mutations(resulting_version_id);
create index mutations_grant_idx on public.profile_mutations(grant_id);
create index jobs_claim_idx on public.processing_jobs(next_run_at, created_at) where status = 'queued';
create index jobs_expired_lease_idx on public.processing_jobs(lease_until) where status = 'running';
create index jobs_document_idx on public.processing_jobs(document_id, owner_id);
create index audit_owner_idx on public.audit_events(owner_id, created_at desc);
create index audit_grant_idx on public.audit_events(grant_id);

create function public.reject_profile_version_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Profile versions are immutable. Create a new version instead.' using errcode = '55000';
end;
$$;

create trigger profile_versions_immutable
  before update on public.profile_versions
  for each row execute function public.reject_profile_version_update();

revoke all on function public.reject_profile_version_update() from public, anon, authenticated;

create function public.clear_document_source_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.profile_sources
    set document_id = null, section_id = null
    where document_id = old.id and owner_id = old.owner_id;
  return old;
end;
$$;

create trigger documents_clear_sources
  before delete on public.documents
  for each row execute function public.clear_document_source_links();

revoke all on function public.clear_document_source_links() from public, anon, authenticated;

commit;
