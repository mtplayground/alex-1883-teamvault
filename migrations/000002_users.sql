create table if not exists users (
  sub text primary key,
  email text not null,
  email_verified boolean not null default false,
  name text,
  picture_url text,
  password_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint users_email_not_blank check (btrim(email) <> ''),
  constraint users_password_hash_not_blank check (
    password_hash is null or btrim(password_hash) <> ''
  )
);

create unique index if not exists users_email_unique_idx
  on users (lower(email));
