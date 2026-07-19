create table if not exists activity_entries (
  id uuid primary key default gen_random_uuid(),
  actor_sub text not null references users(sub) on delete cascade,
  action text not null check (
    action in (
      'user_joined',
      'invitation_sent',
      'invitation_accepted',
      'project_created',
      'document_uploaded',
      'document_shared'
    )
  ),
  workspace_id uuid references workspaces(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  document_id uuid references project_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_entries_workspace_created_idx
  on activity_entries (workspace_id, created_at desc);

create index if not exists activity_entries_actor_created_idx
  on activity_entries (actor_sub, created_at desc);

create index if not exists activity_entries_project_created_idx
  on activity_entries (project_id, created_at desc)
  where project_id is not null;

create index if not exists activity_entries_document_created_idx
  on activity_entries (document_id, created_at desc)
  where document_id is not null;
