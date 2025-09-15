create table shadow_it.organizations (
  id uuid not null default extensions.uuid_generate_v4 (),
  google_org_id text null,
  name text null,
  domain text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  auth_provider character varying(50) null,
  first_admin text null,
  constraint organizations_pkey primary key (id),
  constraint organizations_google_org_id_key unique (google_org_id)
) TABLESPACE pg_default;