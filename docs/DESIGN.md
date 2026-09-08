# Design principles

Commitly shows managers data about named people's work. That's a
different responsibility from a normal internal-tools dashboard — it
needs to be trustworthy and calm, not flashy. These principles exist so
every screen we add feels like it came from the same product, and so
we don't accidentally build something that reads as surveillance.

## 1. Numbers over vibes

Every metric shown is a real, countable thing (PRs merged, hours to
first review, comments left) — never a synthesized "score" or letter
grade. See `docs/METRICS.md` for the full reasoning. When adding a new
metric, ask: can someone see *why* this number is what it is by
clicking into it? If not, don't ship it as a headline number — put it
one level deeper, or don't show it yet.

Corollary: no leaderboards, no ranking-by-default, no red/green
"good/bad" coloring on a person's row. `Needs attention` surfaces
*work* that's stuck (a PR), never a *person* who's underperforming —
that framing difference is deliberate and should hold for every future
feature.

## 2. Context before comparison

A raw number is easy to misread (someone merges fewer PRs this week —
on leave? blocked? doing a big refactor that won't land for a month?).
Prefer showing trend + recent activity over a single static count, and
prefer letting a human annotate context (see the "manager notes /
annotations" item in METRICS.md's feature list) over the dashboard
silently implying a conclusion.

## 3. Calm, dense, dark-first

The dashboard is something a manager checks often, briefly — optimize
for scanning, not for first-impression wow.

- **Dark theme by default** (`bg-neutral-950` / `bg-white/5` cards,
  `border-white/10`). It's easier on the eyes for a tool opened
  repeatedly through the day, and it's what's shipped so far — stay
  consistent rather than introducing a light theme without a plan for
  both.
- **Density over decoration.** Tables and compact cards, not big stat
  tiles with oversized numbers, for anything with more than a handful
  of data points (the developer metrics table). Save more spacious,
  card-heavy layouts for pages with few, high-stakes decisions (the
  onboarding form, `/settings/team`).
- **One accent moment per page, not more.** The amber "Needs attention"
  panel is the one place we use color to mean "look here." If
  everything is highlighted, nothing is.

## 4. Aceternity is for arrival moments, shadcn is for everything else

Aceternity UI's animated/decorative components (gradient backgrounds,
bento grids, sparkles-style effects) are reserved for moments where a
person is *arriving* at the product and forming a first impression —
today that's the login screen background. shadcn/ui's plain
components (`Table`, `Card`, `Badge`, `Input`) are the workhorse for
every data-dense or repeatedly-used screen. Don't animate a table row,
don't add a decorative background behind the metrics table — it fights
scanability, which is principle #3.

If we build a marketing/landing page for signed-out visitors later,
that's the next legitimate place for Aceternity's flashier components
(hero sections, feature showcases) — the dashboard itself stays plain.

## 5. Onboarding is a real product surface, not an afterthought

Commitly is now something a stranger signs up for, so onboarding gets
held to the same bar as the dashboard:

- **Time to first value under a few minutes.** Name, GitHub org,
  token, done — no separate "invite your team" step blocking the
  first look at data (that's why the first sync runs inline during
  onboarding rather than waiting for the next cron).
- **Fail loudly, immediately, in plain language.** The GitHub token
  probe in `createOrganization` exists so a bad token surfaces as "that
  token was rejected" during onboarding, not as a silently empty
  dashboard discovered five minutes later.
- **Never ask for more access than the feature needs.** The onboarding
  copy explicitly says the token is read-only and server-side-only —
  say what we do and don't do with sensitive input, right where we ask
  for it.

## 6. Respect the org boundary everywhere, not just in the UI

Multi-tenancy is enforced in Postgres RLS (see
`supabase/migrations/0002_multi_tenant.sql`), not just by which links
the UI shows. Any new query added to `src/lib/` must be reachable only
through a path that already has `org_id` scoping — never add a query
that trusts a client-supplied org id. When in doubt, follow the
pattern in `src/lib/metrics.ts`: resolve the org from the session
first, then filter every query by it.

## 7. Accessibility and responsiveness aren't optional now

Once this has outside users, "works on my monitor" isn't good enough.
Baseline for every new page:

- Sufficient contrast against `bg-neutral-950` (stick to the
  `neutral-100/300/400/500` text scale already in use — don't drop
  below `neutral-500` for anything that conveys information).
- Every icon-only control needs an accessible label; every form input
  needs a `<Label>` (already the pattern in the onboarding/login
  forms — keep it).
- Tables scroll horizontally on narrow viewports instead of breaking
  layout (`overflow-x-auto`, already on the metrics table — apply the
  same to any new wide table).

## Open questions to revisit as the product grows

- Should developers ever see their own data (not just managers)? That
  would be a meaningful trust-building feature, but changes who
  `org_members` needs to represent (roles beyond admin/manager).
  Worth a deliberate decision, not a default.
- A light theme, if a customer asks for one, needs its own pass — the
  current palette isn't designed to invert cleanly.
