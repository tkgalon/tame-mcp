-- All reads and writes go through the app server with the owner taken from a verified session or token.
-- Browser and OAuth tokens get no direct table access through the Data API.

create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  collection_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 255),
  media_type text not null check (
    media_type in (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown'
    )
  ),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique,
  status text not null default 'uploading' check (
    status in ('uploading', 'ready', 'needs_ocr', 'unsupported', 'failed')
  ),
  error_code text,
  warnings jsonb not null default '[]' check (jsonb_typeof(warnings) = 'array'),
  content_hash text check (content_hash ~ '^[a-f0-9]{64}$'),
  parser_version text,
  created_at timestamptz not null default now(),
  extracted_at timestamptz,
  unique (id, owner_id),
  foreign key (collection_id, owner_id) references public.collections (id, owner_id) on delete cascade,
  check (storage_path = owner_id::text || '/' || id::text || '/original')
);

create index documents_collection_idx on public.documents (collection_id, created_at desc);

create table public.document_sections (
  document_id uuid not null,
  owner_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  page integer check (page > 0),
  heading text,
  content text not null check (length(content) between 1 and 100000),
  primary key (document_id, ordinal),
  foreign key (document_id, owner_id) references public.documents (id, owner_id) on delete cascade
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  active_version_id uuid,
  created_at timestamptz not null default now(),
  unique (id, owner_id)
);

create unique index profiles_owner_name_idx on public.profiles (owner_id, lower(name));

create table public.profile_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  profile_id uuid not null,
  version_number integer not null check (version_number > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  change_reason text check (length(change_reason) <= 1000),
  restored_from_version_id uuid,
  created_at timestamptz not null default now(),
  unique (id, profile_id),
  unique (profile_id, version_number),
  foreign key (profile_id, owner_id) references public.profiles (id, owner_id) on delete cascade
);

alter table public.profiles
  add constraint profiles_active_version_fk foreign key (active_version_id, id)
  references public.profile_versions (id, profile_id) deferrable initially deferred;

create table public.profile_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid,
  base_version_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  preview text not null default '' check (length(preview) <= 6000),
  change_reason text check (length(change_reason) <= 1000),
  changes jsonb,
  status text not null default 'pending' check (status in ('pending', 'published')),
  published_version_id uuid references public.profile_versions (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (profile_id, owner_id) references public.profiles (id, owner_id) on delete cascade,
  foreign key (base_version_id, profile_id) references public.profile_versions (id, profile_id),
  check (base_version_id is null or profile_id is not null)
);

create index profile_drafts_owner_idx on public.profile_drafts (owner_id, created_at desc);

-- Published history must never change, so a rollback always appends a new version
create function public.reject_profile_version_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Profile versions are immutable.' using errcode = '55000';
end;
$$;

create trigger profile_versions_immutable before update on public.profile_versions
  for each row execute function public.reject_profile_version_update();

-- A reviewed draft keeps its content, only its publication state may change
create function public.keep_draft_content() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.payload is distinct from old.payload or new.preview is distinct from old.preview
    or new.profile_id is distinct from old.profile_id
    or new.base_version_id is distinct from old.base_version_id then
    raise exception 'Draft content is immutable.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger profile_drafts_immutable before update on public.profile_drafts
  for each row execute function public.keep_draft_content();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'collections', 'documents', 'document_sections', 'profiles', 'profile_versions', 'profile_drafts'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
  end loop;
end;
$$;

revoke all on function public.reject_profile_version_update() from public, anon, authenticated;
revoke all on function public.keep_draft_content() from public, anon, authenticated;

-- Files are uploaded through signed URLs created by the server, so no storage policies are needed
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
);
