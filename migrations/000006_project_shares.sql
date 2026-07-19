create table if not exists project_shares (
  project_id uuid not null references projects (id) on delete cascade,
  user_sub text not null references users (sub) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_sub)
);

create index if not exists project_shares_user_sub_idx
  on project_shares (user_sub);
