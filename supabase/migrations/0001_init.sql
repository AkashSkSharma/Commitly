-- ============================================================
-- Commitly — initial schema
-- Tracks GitHub org activity (PRs, reviews, comments, commits)
-- for a manager-facing progress dashboard.
-- ============================================================

-- ---------- Reference tables ----------

create table if not exists developers (
  id bigserial primary key,
  github_login text unique not null,
  display_name text,
  avatar_url text,
  team text,                     -- optional grouping, e.g. "Backend", "Mobile"
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists repositories (
  id bigserial primary key,
  github_repo_id bigint unique,
  name text not null,            -- e.g. "checkout-service"
  full_name text unique not null, -- e.g. "zopping/checkout-service"
  is_archived boolean not null default false,
  is_tracked boolean not null default true, -- allow excluding noisy/irrelevant repos
  created_at timestamptz not null default now()
);

-- ---------- Core activity tables ----------

create table if not exists pull_requests (
  id bigserial primary key,
  repo_id bigint not null references repositories(id) on delete cascade,
  github_pr_number int not null,
  github_pr_id bigint unique,
  author_id bigint references developers(id),
  title text,
  state text not null,             -- 'open' | 'closed' | 'merged'
  additions int default 0,
  deletions int default 0,
  changed_files int default 0,
  opened_at timestamptz,
  first_review_at timestamptz,     -- first review activity (any type) after opened_at
  merged_at timestamptz,
  closed_at timestamptz,
  ci_conclusion text,               -- 'success' | 'failure' | 'neutral' | null
  updated_at timestamptz not null default now(),
  unique (repo_id, github_pr_number)
);

create table if not exists pr_reviews (
  id bigserial primary key,
  pr_id bigint not null references pull_requests(id) on delete cascade,
  reviewer_id bigint references developers(id),
  github_review_id bigint unique,
  state text,                       -- 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'
  submitted_at timestamptz,
  body text
);

create table if not exists pr_comments (
  id bigserial primary key,
  pr_id bigint not null references pull_requests(id) on delete cascade,
  author_id bigint references developers(id),
  github_comment_id bigint unique,
  body text,
  created_at timestamptz,
  -- lightweight classification, filled in by the sync job via keyword/label match
  is_testing_related boolean not null default false
);

create table if not exists commits (
  id bigserial primary key,
  repo_id bigint not null references repositories(id) on delete cascade,
  author_id bigint references developers(id),
  sha text not null,
  branch text,
  additions int default 0,
  deletions int default 0,
  authored_at timestamptz,
  message text,
  unique (repo_id, sha)
);

-- ---------- Access control ----------

create table if not exists allowed_managers (
  id bigserial primary key,
  email text unique not null,
  display_name text,
  added_by text,
  created_at timestamptz not null default now()
);

-- ---------- Sync bookkeeping ----------

create table if not exists sync_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- 'running' | 'success' | 'failed'
  repos_synced int default 0,
  prs_synced int default 0,
  error text
);

-- ---------- Indexes ----------

create index if not exists idx_pr_author on pull_requests(author_id);
create index if not exists idx_pr_repo on pull_requests(repo_id);
create index if not exists idx_pr_opened_at on pull_requests(opened_at);
create index if not exists idx_review_reviewer on pr_reviews(reviewer_id);
create index if not exists idx_comment_author on pr_comments(author_id);
create index if not exists idx_commit_author on commits(author_id);
create index if not exists idx_commit_authored_at on commits(authored_at);

-- ---------- Row Level Security ----------
-- Data is only ever read through the server (service role for sync,
-- authenticated manager sessions for reads). No anonymous access.

alter table developers enable row level security;
alter table repositories enable row level security;
alter table pull_requests enable row level security;
alter table pr_reviews enable row level security;
alter table pr_comments enable row level security;
alter table commits enable row level security;
alter table allowed_managers enable row level security;
alter table sync_runs enable row level security;

-- Authenticated users (i.e. logged-in managers) can read activity data.
create policy "authenticated read developers" on developers
  for select using (auth.role() = 'authenticated');
create policy "authenticated read repositories" on repositories
  for select using (auth.role() = 'authenticated');
create policy "authenticated read pull_requests" on pull_requests
  for select using (auth.role() = 'authenticated');
create policy "authenticated read pr_reviews" on pr_reviews
  for select using (auth.role() = 'authenticated');
create policy "authenticated read pr_comments" on pr_comments
  for select using (auth.role() = 'authenticated');
create policy "authenticated read commits" on commits
  for select using (auth.role() = 'authenticated');
create policy "authenticated read sync_runs" on sync_runs
  for select using (auth.role() = 'authenticated');

-- allowed_managers and all writes are service-role only (no policies for
-- anon/authenticated insert/update/delete — the sync script and the
-- login-allowlist check both use the service role key server-side).
