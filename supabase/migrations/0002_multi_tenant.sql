-- ============================================================
-- Commitly — multi-tenant migration
-- Turns the single-org internal tool into a product any company
-- can sign up for: an "organization" owns its own GitHub
-- connection, its own developers/repos/activity, and its own
-- member list. Existing single-tenant data (if any) is folded
-- into a default organization so this migration is safe to run
-- on a database that already has 0001_init.sql applied.
-- ============================================================

-- ---------- Organizations ----------

create table if not exists organizations (
  id bigserial primary key,
  name text not null,
  slug text unique not null,
  github_org text not null,          -- the GitHub org/account this workspace tracks
  github_token text,                 -- fine-grained PAT, server-side only — never
                                      -- select this column from user-facing code;
                                      -- only the admin client (service role) and the
                                      -- sync job read it.
  created_by_email text,
  created_at timestamptz not null default now()
);

create table if not exists org_members (
  id bigserial primary key,
  org_id bigint not null references organizations(id) on delete cascade,
  email text not null,
  user_id uuid,                       -- linked to auth.users.id on first login
  role text not null default 'manager',  -- 'admin' | 'manager'
  invited_by_email text,
  created_at timestamptz not null default now(),
  unique (org_id, email)
);

create index if not exists idx_org_members_user on org_members(user_id);
create index if not exists idx_org_members_email on org_members(email);

-- ---------- Fold in existing single-tenant data, if any ----------

do $$
declare
  default_org_id bigint;
  has_legacy_data boolean;
begin
  select exists(select 1 from repositories) into has_legacy_data;

  if has_legacy_data then
    insert into organizations (name, slug, github_org)
    values ('Default organization', 'default', coalesce(current_setting('app.default_github_org', true), 'zopping'))
    returning id into default_org_id;

    -- Carry over the old global allowlist as this org's members, if that
    -- table still exists from 0001_init.sql.
    if to_regclass('public.allowed_managers') is not null then
      insert into org_members (org_id, email, role)
      select default_org_id, email, 'admin' from allowed_managers
      on conflict (org_id, email) do nothing;
    end if;
  end if;

  -- Add org_id columns (nullable first so backfill can run, then enforce).
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'repositories' and column_name = 'org_id'
  ) then
    alter table repositories add column org_id bigint references organizations(id) on delete cascade;
    if has_legacy_data then
      update repositories set org_id = default_org_id where org_id is null;
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'developers' and column_name = 'org_id'
  ) then
    alter table developers add column org_id bigint references organizations(id) on delete cascade;
    if has_legacy_data then
      update developers set org_id = default_org_id where org_id is null;
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_name = 'sync_runs' and column_name = 'org_id'
  ) then
    alter table sync_runs add column org_id bigint references organizations(id) on delete cascade;
    if has_legacy_data then
      update sync_runs set org_id = default_org_id where org_id is null;
    end if;
  end if;
end $$;

-- Re-scope uniqueness to be per-organization instead of global, now that
-- the same GitHub login or repo name can exist in two different
-- customers' data.
alter table developers drop constraint if exists developers_github_login_key;
create unique index if not exists uq_developers_org_login on developers(org_id, github_login);

alter table repositories drop constraint if exists repositories_full_name_key;
create unique index if not exists uq_repositories_org_full_name on repositories(org_id, full_name);

create index if not exists idx_repositories_org on repositories(org_id);
create index if not exists idx_developers_org on developers(org_id);
create index if not exists idx_sync_runs_org on sync_runs(org_id);

-- allowed_managers is superseded by org_members.
drop table if exists allowed_managers;

-- ---------- Row Level Security, re-scoped per organization ----------

alter table organizations enable row level security;
alter table org_members enable row level security;

drop policy if exists "authenticated read developers" on developers;
drop policy if exists "authenticated read repositories" on repositories;
drop policy if exists "authenticated read pull_requests" on pull_requests;
drop policy if exists "authenticated read pr_reviews" on pr_reviews;
drop policy if exists "authenticated read pr_comments" on pr_comments;
drop policy if exists "authenticated read commits" on commits;
drop policy if exists "authenticated read sync_runs" on sync_runs;

-- A user can see a row if they are a member (matched by their linked
-- user_id) of the organization that row belongs to.
create policy "members read own org" on organizations
  for select using (
    exists (
      select 1 from org_members m
      where m.org_id = organizations.id and m.user_id = auth.uid()
    )
  );

create policy "members read own membership rows" on org_members
  for select using (user_id = auth.uid());

create policy "members read own org repositories" on repositories
  for select using (
    exists (select 1 from org_members m where m.org_id = repositories.org_id and m.user_id = auth.uid())
  );

create policy "members read own org developers" on developers
  for select using (
    exists (select 1 from org_members m where m.org_id = developers.org_id and m.user_id = auth.uid())
  );

create policy "members read own org sync_runs" on sync_runs
  for select using (
    exists (select 1 from org_members m where m.org_id = sync_runs.org_id and m.user_id = auth.uid())
  );

create policy "members read own org pull_requests" on pull_requests
  for select using (
    exists (
      select 1 from repositories r
      join org_members m on m.org_id = r.org_id
      where r.id = pull_requests.repo_id and m.user_id = auth.uid()
    )
  );

create policy "members read own org pr_reviews" on pr_reviews
  for select using (
    exists (
      select 1 from pull_requests p
      join repositories r on r.id = p.repo_id
      join org_members m on m.org_id = r.org_id
      where p.id = pr_reviews.pr_id and m.user_id = auth.uid()
    )
  );

create policy "members read own org pr_comments" on pr_comments
  for select using (
    exists (
      select 1 from pull_requests p
      join repositories r on r.id = p.repo_id
      join org_members m on m.org_id = r.org_id
      where p.id = pr_comments.pr_id and m.user_id = auth.uid()
    )
  );

create policy "members read own org commits" on commits
  for select using (
    exists (
      select 1 from repositories r
      join org_members m on m.org_id = r.org_id
      where r.id = commits.repo_id and m.user_id = auth.uid()
    )
  );

-- organizations/org_members writes (creating an org, inviting members,
-- linking user_id on first login) all go through the service-role admin
-- client server-side — no client-side insert/update policies needed.
