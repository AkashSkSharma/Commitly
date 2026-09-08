# Commitly

A dashboard for managers (technical and non-technical) to see dev team
progress from GitHub activity — PR throughput, code review activity,
testing/QA-related comments, and commit activity — without digging
through GitHub itself. Multi-tenant: any organization can sign up,
connect its own GitHub org, and see only its own team's data.

Stack: **Next.js** (App Router) · **Supabase** (Postgres + auth) ·
**shadcn/ui + Aceternity UI** components · **Vercel** hosting.

## How it works

1. Anyone can sign in with a magic link (no password). Signing in with
   no organization yet lands you on `/onboarding`.
2. Onboarding: name your workspace, paste a GitHub org/username and a
   fine-grained token scoped to it. That creates an `organizations` row
   and runs a first sync immediately.
3. A sync job (`scripts/sync-github.ts`) pulls pull requests, reviews,
   review comments, and commits for every repo in that org's GitHub,
   scoped to `org_id`, and upserts them into Supabase. A daily Vercel
   Cron re-runs it for every organization (`/api/sync`).
4. The dashboard (`/dashboard`) shows a "needs attention" panel (stale
   or unreviewed PRs) plus a per-developer metrics table, and
   `/dev/[github-login]` drills into one person. Everything is scoped
   to the signed-in user's organization via Postgres row-level security
   — see `supabase/migrations/0002_multi_tenant.sql`.
5. Admins can invite/remove teammates from `/settings/team` — inviting
   just adds an email to `org_members`; they get access the moment they
   sign in with that email.

## One-time setup

### 1. Create a Supabase project

Create a project at supabase.com, then in the SQL editor run both
migrations in order: `supabase/migrations/0001_init.sql` then
`supabase/migrations/0002_multi_tenant.sql`. Together they create every
table, index, and the org-scoped row-level-security policies.

In Supabase Auth settings, make sure "Email" provider is enabled and
that magic-link / OTP sign-in is on (default). Set the Site URL and
Redirect URLs to your deployed domain (and `http://localhost:3000` for
local dev) — Authentication → URL Configuration.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase
  dashboard → Project Settings → API
- `SUPABASE_SERVICE_ROLE_KEY` — same page (keep this secret, server-only)
- `NEXT_PUBLIC_SITE_URL` — `http://localhost:3000` locally, your Vercel
  URL in production
- `CRON_SECRET` — any random string; protects the `/api/sync` endpoint

There's no global GitHub token env var anymore — each organization
connects its own during onboarding (see below).

### 3. Install and run locally

```bash
npm install
npm run dev
```

Without Supabase env vars set, every page redirects to `/setup` with
instructions instead of crashing — handy for a fresh checkout.

### 4. Sign up and connect GitHub

Open `http://localhost:3000`, sign in with your email (check your
inbox for the magic link), then follow the onboarding form: pick a
workspace name, enter your GitHub org/username, and paste a
fine-grained personal access token
(github.com/settings/personal-access-tokens/new) scoped to that org
with **read-only** access to Contents, Pull requests, and Metadata.
The first sync kicks off immediately.

To re-run a sync manually later:

```bash
npx tsx scripts/sync-github.ts <your-org-slug>   # one organization
npx tsx scripts/sync-github.ts --all             # every organization
```

## Deploying

1. Push this repo to GitHub, import it into Vercel.
2. Add the env vars from `.env.local` to the Vercel project (Production
   + Preview).
3. `vercel.json` already defines a daily cron (`0 3 * * *`, i.e. 3am UTC
   / 8:30am IST) hitting `/api/sync`, which syncs every organization.
   Vercel sends `CRON_SECRET` automatically as a Bearer token, so no
   extra config needed. As the number of organizations grows, consider
   fanning this out to one invocation per org instead of one big loop
   (see the note in `src/app/api/sync/route.ts` about the serverless
   time limit).

## Managing teammates

Each organization's admin manages access from `/settings/team` —
inviting adds an email to that org's member list; they get in the
moment they sign in with that email. No redeploy, no SQL needed.

## What counts as "progress" right now

See `docs/METRICS.md` for the full breakdown and the reasoning behind
each metric, plus a running list of feature ideas to add next.
