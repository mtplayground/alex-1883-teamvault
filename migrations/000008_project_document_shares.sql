alter table project_documents
  add constraint project_documents_id_workspace_project_unique
    unique (id, workspace_id, project_id);

create table if not exists project_document_shares (
  document_id uuid not null,
  workspace_id uuid not null,
  project_id uuid not null,
  user_sub text not null,
  shared_by_sub text not null references users (sub) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (document_id, user_sub),
  constraint project_document_shares_document_fk
    foreign key (document_id, workspace_id, project_id)
    references project_documents (id, workspace_id, project_id)
    on delete cascade,
  constraint project_document_shares_membership_fk
    foreign key (workspace_id, user_sub)
    references workspace_memberships (workspace_id, user_sub)
    on delete cascade
);

create index if not exists project_document_shares_project_id_idx
  on project_document_shares (project_id);

create index if not exists project_document_shares_user_sub_idx
  on project_document_shares (user_sub);
