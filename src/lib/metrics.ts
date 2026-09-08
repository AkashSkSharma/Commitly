import { createClient as createServerSupabase } from "@/lib/supabase/server";

/**
 * All the metrics queries backing the dashboard, scoped to one
 * organization at a time. See docs/METRICS.md for the reasoning behind
 * each metric.
 */

export type DevSummary = {
  id: number;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
  team: string | null;
  prsOpened: number;
  prsMerged: number;
  avgTimeToMergeHours: number | null;
  avgPrSizeLines: number | null;
  reviewsGiven: number;
  reviewCommentsGiven: number;
  avgReviewTurnaroundHours: number | null;
  testingComments: number;
  commits: number;
  activeDays: number;
  linesChanged: number;
};

const DEFAULT_WINDOW_DAYS = 30;

export async function getTeamSummary(
  orgId: number,
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<DevSummary[]> {
  const supabase = await createServerSupabase();
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: developers, error: devError } = await supabase
    .from("developers")
    .select("id, github_login, display_name, avatar_url, team")
    .eq("org_id", orgId)
    .eq("is_active", true);

  if (devError || !developers) return [];

  const { data: orgRepoIds } = await supabase
    .from("repositories")
    .select("id")
    .eq("org_id", orgId);
  const repoIds = (orgRepoIds ?? []).map((r) => r.id);
  if (repoIds.length === 0) return developers.map((d) => emptyDevSummary(d));

  // Pull the raw rows for the window and aggregate in application code —
  // simplest to reason about at this data volume; move to SQL views/RPC
  // once an org has grown past a few thousand PRs.
  const [{ data: prs }, { data: reviews }, { data: comments }, { data: commitsRows }] =
    await Promise.all([
      supabase
        .from("pull_requests")
        .select("author_id, state, opened_at, first_review_at, merged_at, additions, deletions")
        .in("repo_id", repoIds)
        .gte("opened_at", since),
      supabase
        .from("pr_reviews")
        .select("reviewer_id, submitted_at, pull_requests!inner(repo_id)")
        .in("pull_requests.repo_id", repoIds)
        .gte("submitted_at", since),
      supabase
        .from("pr_comments")
        .select("author_id, created_at, is_testing_related, pull_requests!inner(repo_id)")
        .in("pull_requests.repo_id", repoIds)
        .gte("created_at", since),
      supabase
        .from("commits")
        .select("author_id, authored_at, additions, deletions")
        .in("repo_id", repoIds)
        .gte("authored_at", since),
    ]);

  return developers.map((dev) => {
    const devPrs = (prs ?? []).filter((p) => p.author_id === dev.id);
    const merged = devPrs.filter((p) => p.state === "merged");

    const mergeTimes = merged
      .filter((p) => p.opened_at && p.merged_at)
      .map(
        (p) =>
          (new Date(p.merged_at!).getTime() - new Date(p.opened_at!).getTime()) /
          (1000 * 60 * 60)
      );

    const reviewTurnarounds = devPrs
      .filter((p) => p.opened_at && p.first_review_at)
      .map(
        (p) =>
          (new Date(p.first_review_at!).getTime() -
            new Date(p.opened_at!).getTime()) /
          (1000 * 60 * 60)
      );

    const devReviews = (reviews ?? []).filter((r) => r.reviewer_id === dev.id);
    const devComments = (comments ?? []).filter((c) => c.author_id === dev.id);
    const devCommits = (commitsRows ?? []).filter((c) => c.author_id === dev.id);

    const activeDays = new Set(
      devCommits.map((c) => c.authored_at?.slice(0, 10)).filter(Boolean)
    ).size;

    const linesChanged = devCommits.reduce(
      (sum, c) => sum + (c.additions ?? 0) + (c.deletions ?? 0),
      0
    );

    return {
      id: dev.id,
      githubLogin: dev.github_login,
      displayName: dev.display_name,
      avatarUrl: dev.avatar_url,
      team: dev.team,
      prsOpened: devPrs.length,
      prsMerged: merged.length,
      avgTimeToMergeHours: average(mergeTimes),
      avgPrSizeLines: average(
        devPrs.map((p) => (p.additions ?? 0) + (p.deletions ?? 0))
      ),
      reviewsGiven: devReviews.length,
      reviewCommentsGiven: devComments.length,
      avgReviewTurnaroundHours: average(reviewTurnarounds),
      testingComments: devComments.filter((c) => c.is_testing_related).length,
      commits: devCommits.length,
      activeDays,
      linesChanged,
    };
  });
}

function emptyDevSummary(dev: {
  id: number;
  github_login: string;
  display_name: string | null;
  avatar_url: string | null;
  team: string | null;
}): DevSummary {
  return {
    id: dev.id,
    githubLogin: dev.github_login,
    displayName: dev.display_name,
    avatarUrl: dev.avatar_url,
    team: dev.team,
    prsOpened: 0,
    prsMerged: 0,
    avgTimeToMergeHours: null,
    avgPrSizeLines: null,
    reviewsGiven: 0,
    reviewCommentsGiven: 0,
    avgReviewTurnaroundHours: null,
    testingComments: 0,
    commits: 0,
    activeDays: 0,
    linesChanged: 0,
  };
}

export type NeedsAttentionPr = {
  id: number;
  repoFullName: string;
  prNumber: number;
  title: string;
  authorLogin: string | null;
  openedAt: string;
  daysOpen: number;
  hasReview: boolean;
};

/**
 * PRs that need a manager's eyes right now: open, and either nobody has
 * reviewed them yet after a few days, or they've been open a long time
 * regardless. This is the "what's actually stuck" view, separate from
 * the raw per-developer metrics table below it.
 */
export async function getNeedsAttention(
  orgId: number,
  { staleReviewDays = 2, staleOpenDays = 7 } = {}
): Promise<NeedsAttentionPr[]> {
  const supabase = await createServerSupabase();

  const { data: orgRepos } = await supabase
    .from("repositories")
    .select("id, full_name")
    .eq("org_id", orgId);
  const repoMap = new Map((orgRepos ?? []).map((r) => [r.id, r.full_name]));
  if (repoMap.size === 0) return [];

  const { data: openPrs } = await supabase
    .from("pull_requests")
    .select("id, repo_id, github_pr_number, title, opened_at, first_review_at, author_id")
    .in("repo_id", Array.from(repoMap.keys()))
    .eq("state", "open")
    .order("opened_at", { ascending: true });

  if (!openPrs || openPrs.length === 0) return [];

  const authorIds = Array.from(
    new Set(openPrs.map((p) => p.author_id).filter((id): id is number => id !== null))
  );
  const { data: authors } = await supabase
    .from("developers")
    .select("id, github_login")
    .in("id", authorIds);
  const authorMap = new Map((authors ?? []).map((a) => [a.id, a.github_login]));

  const now = Date.now();
  const results: NeedsAttentionPr[] = [];

  for (const pr of openPrs) {
    if (!pr.opened_at) continue;
    const daysOpen = (now - new Date(pr.opened_at).getTime()) / (1000 * 60 * 60 * 24);
    const hasReview = !!pr.first_review_at;

    const isStale =
      daysOpen >= staleOpenDays || (!hasReview && daysOpen >= staleReviewDays);
    if (!isStale) continue;

    results.push({
      id: pr.id,
      repoFullName: repoMap.get(pr.repo_id) ?? "repo",
      prNumber: pr.github_pr_number,
      title: pr.title ?? "",
      authorLogin: pr.author_id !== null ? authorMap.get(pr.author_id) ?? null : null,
      openedAt: pr.opened_at,
      daysOpen: Math.floor(daysOpen),
      hasReview,
    });
  }

  return results.sort((a, b) => b.daysOpen - a.daysOpen);
}

export async function getDeveloperDetail(orgId: number, githubLogin: string) {
  const supabase = await createServerSupabase();

  const { data: dev } = await supabase
    .from("developers")
    .select("id, github_login, display_name, avatar_url, team")
    .eq("org_id", orgId)
    .eq("github_login", githubLogin)
    .maybeSingle();

  if (!dev) return null;

  const { data: prs } = await supabase
    .from("pull_requests")
    .select(
      "id, github_pr_number, title, state, additions, deletions, opened_at, merged_at, first_review_at, repo_id, repositories!inner(org_id, full_name)"
    )
    .eq("author_id", dev.id)
    .eq("repositories.org_id", orgId)
    .order("opened_at", { ascending: false })
    .limit(50);

  const { data: comments } = await supabase
    .from("pr_comments")
    .select(
      "body, created_at, is_testing_related, pull_requests!inner(title, github_pr_number, repositories!inner(org_id))"
    )
    .eq("author_id", dev.id)
    .eq("pull_requests.repositories.org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);

  return { dev, prs: prs ?? [], comments: comments ?? [] };
}

export async function getLastSyncRun(orgId: number) {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sync_runs")
    .select("*")
    .eq("org_id", orgId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
