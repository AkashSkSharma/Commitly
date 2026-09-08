import { createClient as createServerSupabase } from "@/lib/supabase/server";

/**
 * All the metrics queries backing the dashboard. Kept in one place so
 * the "what counts as progress" definition lives in exactly one spot —
 * see docs/METRICS.md for the reasoning behind each one.
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
  windowDays: number = DEFAULT_WINDOW_DAYS
): Promise<DevSummary[]> {
  const supabase = await createServerSupabase();
  const since = new Date(
    Date.now() - windowDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: developers, error: devError } = await supabase
    .from("developers")
    .select("id, github_login, display_name, avatar_url, team")
    .eq("is_active", true);

  if (devError || !developers) return [];

  // Pull the raw rows for the window and aggregate in application code —
  // simplest to reason about at this data volume; move to SQL views/RPC
  // once a single org has grown past a few thousand PRs.
  const [{ data: prs }, { data: reviews }, { data: comments }, { data: commitsRows }] =
    await Promise.all([
      supabase
        .from("pull_requests")
        .select("author_id, state, opened_at, first_review_at, merged_at, additions, deletions")
        .gte("opened_at", since),
      supabase
        .from("pr_reviews")
        .select("reviewer_id, submitted_at")
        .gte("submitted_at", since),
      supabase
        .from("pr_comments")
        .select("author_id, created_at, is_testing_related")
        .gte("created_at", since),
      supabase
        .from("commits")
        .select("author_id, authored_at, additions, deletions")
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
      devCommits
        .map((c) => c.authored_at?.slice(0, 10))
        .filter(Boolean)
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

export async function getDeveloperDetail(githubLogin: string) {
  const supabase = await createServerSupabase();

  const { data: dev } = await supabase
    .from("developers")
    .select("id, github_login, display_name, avatar_url, team")
    .eq("github_login", githubLogin)
    .maybeSingle();

  if (!dev) return null;

  const { data: prs } = await supabase
    .from("pull_requests")
    .select(
      "id, github_pr_number, title, state, additions, deletions, opened_at, merged_at, first_review_at, repo_id, repositories(full_name)"
    )
    .eq("author_id", dev.id)
    .order("opened_at", { ascending: false })
    .limit(50);

  const { data: comments } = await supabase
    .from("pr_comments")
    .select("body, created_at, is_testing_related, pull_requests(title, github_pr_number)")
    .eq("author_id", dev.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return { dev, prs: prs ?? [], comments: comments ?? [] };
}

export async function getLastSyncRun() {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
