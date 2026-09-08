# Commitly

A simple internal dashboard for managers (technical and non-technical) to
see dev team progress from GitHub activity — PR throughput, code review
activity, testing/QA-related comments, and commit activity — without
digging through GitHub itself.

Stack: **Next.js** (App Router) · **Supabase** (Postgres + auth) ·
**shadcn/ui + Aceternity UI** components · **Vercel** hosting.

## How it works

1. A sync job (`scripts/sync-github.ts`) uses a GitHub personal access
   token to pull pull requests, reviews, review comments, and commits
   for every repo in your GitHub org, and upserts them into Supabase.
2. The Next.js app reads from Supabase and renders a team overview
   (`/dashboard`) and a per-developer detail page (`/dev/[github-login]`).
3. Managers log in with a Supabase magic link — no password, but only
   emails in the `allowed_managers` table can request one.

## One-time setup

### 1. Create a Supabase project

Create a project at supabase.com, then in the SQL editor run the
migration in `supabase/migrations/0001_init.sql`. This creates all
tables, indexes, and row-level-security policies.

Add yourself (and any other manager) to the allowlist:

```sql
insert into allowed_managers (email, display_name)
values ('you@zopping.com', 'Your Name');
```

In Supabase Auth settings, make sure "Email" provider is enabled and
that magic-link / OTP sign-in is on (default). Set the Site URL and
Redirect URLs to your deployed domain (and `http://localhost:3000` for
local dev) — Authentication → URL Configuration.

### 2. Create a GitHub token

GitHub → Settings → Developer settings → Fine-grained personal access
tokens → generate one scoped to your org, with **read-only** access to:
Contents, Pull requests, Metadata.

(This is separate from — and safer than — the full-access token style
used in your local `zoppingsync.sh` script, since this one only ever
needs read access and runs on a schedule instead of your machine.)

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase
  dashboard → Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page (keep this secret, server-only)
- `GITHUB_TOKEN` — the fine-grained PAT from step 2
- `GITHUB_ORG` — e.g. `zopping`
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000` locally, your Vercel
  URL in production
- `CRON_SECRET` — any random string; protects the `/api/sync` endpoint

### 4. Install and run locally

```bash
npm install
npm run dev
```

### 5. Run the first sync

```bash
npx tsx scripts/sync-github.ts
```

This pulls the last 90 days (configurable via `SYNC_LOOKBACK_DAYS`) of
activity for every repo in the org. Re-run it any time to refresh data
manually.

## Deploying

1. Push this repo to GitHub, import it into Vercel.
2. Add all the env vars from `.env.local` to the Vercel project
   (Production + Preview).
3. `vercel.json` already defines a daily cron (`0 3 * * *`, i.e. 3am UTC
   / 8:30am IST) hitting `/api/sync` to keep data fresh — Vercel sends
   the `CRON_SECRET` automatically as a Bearer token when the env var is
   set, so no extra config needed. Adjust the schedule to your org's
   size — bigger orgs may need a less frequent or longer-running sync
   (see the note in `src/app/api/sync/route.ts` about the serverless
   time limit).

## Adding / removing managers

Managers are controlled entirely by the `allowed_managers` table —
add or delete rows directly in the Supabase table editor. No redeploy
needed.

## Excluding repos from tracking

Set `GITHUB_IGNORED_REPOS` to a comma-separated list of repo names
(not full `org/repo`, just the repo name) to skip syncing them — handy
for forks, archived experiments, or anything not relevant to
performance tracking.

## What counts as "progress" right now

See `docs/METRICS.md` for the full breakdown and the reasoning behind
each metric, plus a running list of feature ideas to add next.
