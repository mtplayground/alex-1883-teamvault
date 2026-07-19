alter table projects
  add constraint projects_id_workspace_id_unique unique (id, workspace_id);

create table if not exists project_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  project_id uuid not null,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  uploader_sub text not null references users (sub) on delete restrict,
  storage_key text not null unique,
  uploaded_at timestamptz not null default now(),
  constraint project_documents_project_workspace_fk
    foreign key (project_id, workspace_id)
    references projects (id, workspace_id)
    on delete cascade,
  constraint project_documents_file_name_not_blank check (btrim(file_name) <> ''),
  constraint project_documents_content_type_not_blank check (btrim(content_type) <> ''),
  constraint project_documents_size_bytes_nonnegative check (size_bytes >= 0)
);

create index if not exists project_documents_project_id_uploaded_at_idx
  on project_documents (project_id, uploaded_at desc);

create index if not exists project_documents_uploader_sub_idx
  on project_documents (uploader_sub);
