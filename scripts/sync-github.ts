/**
 * GitHub -> Supabase sync job.
 *
 * Pulls all non-ignored repos in GITHUB_ORG, and for each repo, all pull
 * requests (last 90 days by default) with their reviews, review comments,
 * and commits, then upserts everything into Supabase.
 *
 * Run manually:   npx tsx scripts/sync-github.ts
 * Run on Vercel:  wire this up as a Vercel Cron Job hitting
 *                 /api/sync (see src/app/api/sync/route.ts), which calls
 *                 the same logic.
 */
import "dotenv/config";
import { graphql } from "@octokit/graphql";
import { createAdminClient } from "../src/lib/supabase/admin";

const ORG = process.env.GITHUB_ORG!;
const TOKEN = process.env.GITHUB_TOKEN!;
const IGNORED = new Set(
  (process.env.GITHUB_IGNORED_REPOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
// How far back to pull PR activity on each run. Wide enough to catch
// long-lived PRs, narrow enough to keep each run fast.
const LOOKBACK_DAYS = Number(process.env.SYNC_LOOKBACK_DAYS ?? 90);

const gh = graphql.defaults({
  headers: { authorization: `token ${TOKEN}` },
});

// Simple heuristic for "testing/QA-related" PR comments, per the
// dashboard's testing-signal metric. Extend this list as real comment
// patterns show up.
const TESTING_KEYWORDS = [
  "test",
  "tests",
  "tested",
  "testing",
  "qa",
  "coverage",
  "regression",
  "ci passed",
  "ci failed",
  "lgtm after tests",
];

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isTestingRelated(body: string | null | undefined) {
  if (!body) return false;
  const lower = body.toLowerCase();
  return TESTING_KEYWORDS.some((kw) => lower.includes(kw));
}

type GqlRepo = {
  name: string;
  databaseId: number;
  isArchived: boolean;
  pullRequests: { nodes: GqlPR[] };
};

type GqlPR = {
  number: number;
  databaseId: number;
  title: string;
  state: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  author: { login: string; avatarUrl: string } | null;
  commits: {
    nodes: {
      commit: {
        oid: string;
        message: string;
        additions: number;
        deletions: number;
        authoredDate: string;
        author: { user: { login: string } | null };
      };
    }[];
  };
  reviews: {
    nodes: {
      databaseId: number;
      state: string;
      submittedAt: string;
      body: string;
      author: { login: string } | null;
    }[];
  };
  comments: {
    nodes: {
      databaseId: number;
      body: string;
      createdAt: string;
      author: { login: string } | null;
    }[];
  };
};

const REPO_QUERY = /* GraphQL */ `
  query ($org: String!, $cursor: String, $since: DateTime!) {
    organization(login: $org) {
      repositories(first: 20, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          name
          databaseId
          isArchived
          pullRequests(
            first: 30
            orderBy: { field: UPDATED_AT, direction: DESC }
          ) {
            nodes {
              number
              databaseId
              title
              state
              additions
              deletions
              changedFiles
              createdAt
              mergedAt
              closedAt
              author {
                login
                avatarUrl
              }
              commits(first: 50) {
                nodes {
                  commit {
                    oid
                    message
                    additions
                    deletions
                    authoredDate
                    author {
                      user {
                        login
                      }
                    }
                  }
                }
              }
              reviews(first: 30) {
                nodes {
                  databaseId
                  state
                  submittedAt
                  body
                  author {
                    login
                  }
                }
              }
              comments(first: 50) {
                nodes {
                  databaseId
                  body
                  createdAt
                  author {
                    login
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

type OrgReposQueryResult = {
  organization: {
    repositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: GqlRepo[];
    };
  };
};

async function fetchOrgRepos(): Promise<GqlRepo[]> {
  const since = new Date(
    Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const repos: GqlRepo[] = [];
  let cursor: string | null = null;

  while (true) {
    const result = await gh(REPO_QUERY, {
      org: ORG,
      cursor,
      since,
    }) as OrgReposQueryResult;
    const page = result.organization.repositories;
    repos.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  return repos;
}

export async function main() {
  const supabase = createAdminClient();

  const { data: syncRun } = await supabase
    .from("sync_runs")
    .insert({ status: "running" })
    .select()
    .single();

  let reposSynced = 0;
  let prsSynced = 0;

  try {
    console.log(`Fetching repos for org "${ORG}"...`);
    const repos = await fetchOrgRepos();
    console.log(`Fetched ${repos.length} repos.`);

    // Cache of github_login -> developer row id, populated as we see authors.
    const developerCache = new Map<string, number>();

    async function getOrCreateDeveloper(
      login: string,
      avatarUrl?: string
    ): Promise<number> {
      if (developerCache.has(login)) return developerCache.get(login)!;

      const { data, error } = await supabase
        .from("developers")
        .upsert(
          { github_login: login, avatar_url: avatarUrl },
          { onConflict: "github_login", ignoreDuplicates: false }
        )
        .select("id")
        .single();

      if (error || !data) throw error ?? new Error("upsert developer failed");
      developerCache.set(login, data.id);
      return data.id;
    }

    for (const repo of repos) {
      if (IGNORED.has(repo.name)) continue;

      const { data: repoRow, error: repoError } = await supabase
        .from("repositories")
        .upsert(
          {
            github_repo_id: repo.databaseId,
            name: repo.name,
            full_name: `${ORG}/${repo.name}`,
            is_archived: repo.isArchived,
          },
          { onConflict: "full_name" }
        )
        .select("id")
        .single();

      if (repoError || !repoRow) {
        console.error(`  ! failed to upsert repo ${repo.name}`, repoError);
        continue;
      }

      for (const pr of repo.pullRequests.nodes) {
        const authorId = pr.author
          ? await getOrCreateDeveloper(pr.author.login, pr.author.avatarUrl)
          : null;

        // First review activity timestamp, for review-turnaround metric.
        const firstReviewAt = pr.reviews.nodes
          .map((r) => r.submittedAt)
          .filter(Boolean)
          .sort()[0];

        const { data: prRow, error: prError } = await supabase
          .from("pull_requests")
          .upsert(
            {
              repo_id: repoRow.id,
              github_pr_number: pr.number,
              github_pr_id: pr.databaseId,
              author_id: authorId,
              title: pr.title,
              state: pr.mergedAt
                ? "merged"
                : pr.state.toLowerCase(),
              additions: pr.additions,
              deletions: pr.deletions,
              changed_files: pr.changedFiles,
              opened_at: pr.createdAt,
              first_review_at: firstReviewAt ?? null,
              merged_at: pr.mergedAt,
              closed_at: pr.closedAt,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "repo_id,github_pr_number" }
          )
          .select("id")
          .single();

        if (prError || !prRow) {
          console.error(
            `  ! failed to upsert PR #${pr.number} in ${repo.name}`,
            prError
          );
          continue;
        }
        prsSynced++;

        for (const review of pr.reviews.nodes) {
          const reviewerId = review.author
            ? await getOrCreateDeveloper(review.author.login)
            : null;
          await supabase.from("pr_reviews").upsert(
            {
              pr_id: prRow.id,
              reviewer_id: reviewerId,
              github_review_id: review.databaseId,
              state: review.state,
              submitted_at: review.submittedAt,
              body: review.body,
            },
            { onConflict: "github_review_id" }
          );
        }

        for (const comment of pr.comments.nodes) {
          const commentAuthorId = comment.author
            ? await getOrCreateDeveloper(comment.author.login)
            : null;
          await supabase.from("pr_comments").upsert(
            {
              pr_id: prRow.id,
              author_id: commentAuthorId,
              github_comment_id: comment.databaseId,
              body: comment.body,
              created_at: comment.createdAt,
              is_testing_related: isTestingRelated(comment.body),
            },
            { onConflict: "github_comment_id" }
          );
        }

        for (const c of pr.commits.nodes) {
          const commitLogin = c.commit.author.user?.login;
          const commitAuthorId = commitLogin
            ? await getOrCreateDeveloper(commitLogin)
            : null;
          await supabase.from("commits").upsert(
            {
              repo_id: repoRow.id,
              author_id: commitAuthorId,
              sha: c.commit.oid,
              additions: c.commit.additions,
              deletions: c.commit.deletions,
              authored_at: c.commit.authoredDate,
              message: c.commit.message,
            },
            { onConflict: "repo_id,sha" }
          );
        }
      }

      reposSynced++;
      console.log(`  synced ${repo.name}: ${repo.pullRequests.nodes.length} PRs`);
    }

    await supabase
      .from("sync_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        repos_synced: reposSynced,
        prs_synced: prsSynced,
      })
      .eq("id", syncRun!.id);

    console.log(
      `Done. ${reposSynced} repos, ${prsSynced} PRs synced.`
    );
    return { reposSynced, prsSynced };
  } catch (err: unknown) {
    console.error("Sync failed:", err);
    if (syncRun) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          repos_synced: reposSynced,
          prs_synced: prsSynced,
          error: errorMessage(err),
        })
        .eq("id", syncRun.id);
    }
    throw err;
  }
}

// Only run immediately when invoked directly (CLI usage). When imported
// by the API route, `main` is called explicitly instead.
if (require.main === module) {
  main().catch(() => process.exit(1));
}
