-- Anyone with a Google account can sign in, but only approved emails can use collections, profiles and MCP tools.
-- The owner approves an account by inserting its email here.

create table public.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);

alter table public.allowed_emails enable row level security;
revoke all on table public.allowed_emails from public, anon, authenticated;
