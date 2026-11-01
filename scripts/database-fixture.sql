-- Minimal Supabase primitives for an isolated PostgreSQL test cluster
-- This fixture is never applied to a hosted or user-provided database
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;
create table auth.users (id uuid primary key, banned_until timestamptz);
create table auth.oauth_clients (id uuid primary key, deleted_at timestamptz, client_name text);
create table auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  oauth_client_id uuid references auth.oauth_clients(id) on delete cascade,
  not_after timestamptz
);
create table auth.oauth_authorizations (
  authorization_id text primary key, client_id uuid not null references auth.oauth_clients(id),
  user_id uuid references auth.users(id), redirect_uri text not null, scope text not null default 'openid',
  state text, resource text, status text not null default 'pending', authorization_code text,
  code_challenge_method text, expires_at timestamptz not null default now() + interval '10 minutes'
);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,
  metadata jsonb,
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated, service_role;
