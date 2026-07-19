create table if not exists workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  email text not null,
  role text not null,
  token_hash text not null unique,
  invited_by_sub text not null references users (sub) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  revoked_at timestamptz,
  constraint workspace_invitations_email_not_blank check (btrim(email) <> ''),
  constraint workspace_invitations_role_valid check (role in ('member', 'guest'))
);

create index if not exists workspace_invitations_workspace_pending_idx
  on workspace_invitations (workspace_id, created_at)
  where accepted_at is null and revoked_at is null;

create index if not exists workspace_invitations_email_idx
  on workspace_invitations (lower(email));
