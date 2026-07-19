create extension if not exists pgcrypto;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by_sub text not null references users (sub) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_name_not_blank check (btrim(name) <> '')
);

create table if not exists workspace_memberships (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_sub text not null references users (sub) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_sub),
  constraint workspace_memberships_role_valid check (
    role in ('owner', 'member', 'guest')
  )
);

create index if not exists workspace_memberships_user_sub_idx
  on workspace_memberships (user_sub);

create index if not exists workspace_memberships_role_idx
  on workspace_memberships (workspace_id, role);
