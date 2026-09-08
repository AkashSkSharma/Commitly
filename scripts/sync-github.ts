/**
 * GitHub -> Supabase sync job — org-aware.
 *
 * `runSync` pulls all non-ignored repos for one organization's connected
 * GitHub org, and for each repo, all pull requests (last N days) with
 * their reviews, review comments, and commits, then upserts everything
 * into Supabase scoped to that organization's org_id.
 *
 * Run manually for one org:  npx tsx scripts/sync-github.ts <org-slug>
 * Run for every org:          npx tsx scripts/sync-github.ts --all
 * Run on Vercel:               /api/sync loops over all organizations
 *                              and calls runSync for each (see
 *                              src/app/api/sync/route.ts).
 */
import "dotenv/config";
import { graphql } from "@octokit/graphql";
import { createAdminClient } from "../src/lib/supabase/admin";

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
  query ($org: String!, $cursor: String) {
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

async function fetchOrgRepos(
  githubOrg: string,
  token: string
): Promise<GqlRepo[]> {
  const gh = graphql.defaults({
    headers: { authorization: `token ${token}` },
  });

  const repos: GqlRepo[] = [];
  let cursor: string | null = null;

  while (true) {
    const result = (await gh(REPO_QUERY, {
      org: githubOrg,
      cursor,
    })) as OrgReposQueryResult;
    const page = result.organization.repositories;
    repos.push(...page.nodes);
    if (!page.pageInfo.hasNextPage) break;
    cursor = page.pageInfo.endCursor;
  }

  return repos;
}

export type SyncParams = {
  orgId: number;
  githubOrg: string;
  githubToken: string;
  ignoredRepos?: string[];
};

export type SyncResult = { reposSynced: number; prsSynced: number };

/**
 * Syncs one Commitly organization's GitHub activity into Supabase. This
 * is the function both the CLI entrypoint below and /api/sync call —
 * everything it writes is tagged with `orgId` so organizations' data
 * never mixes.
 */
export async function runSync(params: SyncParams): Promise<SyncResult> {
  const { orgId, githubOrg, githubToken } = params;
  const ignored = new Set(params.ignoredRepos ?? []);
  const supabase = createAdminClient();

  const { data: syncRun } = await supabase
    .from("sync_runs")
    .insert({ status: "running", org_id: orgId })
    .select()
    .single();

  let reposSynced = 0;
  let prsSynced = 0;

  try {
    console.log(`[org ${orgId}] Fetching repos for "${githubOrg}"...`);
    const repos = await fetchOrgRepos(githubOrg, githubToken);
    console.log(`[org ${orgId}] Fetched ${repos.length} repos.`);

    // Cache of github_login -> developer row id, populated as we see
    // authors. Scoped per-run (per-org) since the same login can be a
    // different developer row in a different organization.
    const developerCache = new Map<string, number>();

    async function getOrCreateDeveloper(
      login: string,
      avatarUrl?: string
    ): Promise<number> {
      if (developerCache.has(login)) return developerCache.get(login)!;

      const { data, error } = await supabase
        .from("developers")
        .upsert(
          { org_id: orgId, github_login: login, avatar_url: avatarUrl },
          { onConflict: "org_id,github_login", ignoreDuplicates: false }
        )
        .select("id")
        .single();

      if (error || !data) throw error ?? new Error("upsert developer failed");
      developerCache.set(login, data.id);
      return data.id;
    }

    for (const repo of repos) {
      if (ignored.has(repo.name)) continue;

      const { data: repoRow, error: repoError } = await supabase
        .from("repositories")
        .upsert(
          {
            org_id: orgId,
            github_repo_id: repo.databaseId,
            name: repo.name,
            full_name: `${githubOrg}/${repo.name}`,
            is_archived: repo.isArchived,
          },
          { onConflict: "org_id,full_name" }
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
              state: pr.mergedAt ? "merged" : pr.state.toLowerCase(),
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

    console.log(`[org ${orgId}] Done. ${reposSynced} repos, ${prsSynced} PRs synced.`);
    return { reposSynced, prsSynced };
  } catch (err: unknown) {
    console.error(`[org ${orgId}] Sync failed:`, err);
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

/** Syncs every organization in Supabase. Used by /api/sync and by the CLI's --all mode. */
export async function runSyncForAllOrgs(): Promise<
  { orgId: number; slug: string; result?: SyncResult; error?: string }[]
> {
  const supabase = createAdminClient();
  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, slug, github_org, github_token");

  if (error || !orgs) throw error ?? new Error("failed to list organizations");

  const results = [];
  for (const org of orgs) {
    if (!org.github_token) {
      results.push({
        orgId: org.id,
        slug: org.slug,
        error: "no GitHub token configured",
      });
      continue;
    }
    try {
      const result = await runSync({
        orgId: org.id,
        githubOrg: org.github_org,
        githubToken: org.github_token,
      });
      results.push({ orgId: org.id, slug: org.slug, result });
    } catch (err) {
      results.push({ orgId: org.id, slug: org.slug, error: errorMessage(err) });
    }
  }
  return results;
}

// ---------- CLI entrypoint ----------
// Usage:
//   npx tsx scripts/sync-github.ts --all        sync every organization
//   npx tsx scripts/sync-github.ts <org-slug>    sync one organization
async function cli() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: npx tsx scripts/sync-github.ts <org-slug> | --all"
    );
    process.exit(1);
  }

  if (arg === "--all") {
    const results = await runSyncForAllOrgs();
    console.table(results.map((r) => ({ ...r, result: undefined, ...r.result })));
    return;
  }

  const supabase = createAdminClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, github_org, github_token")
    .eq("slug", arg)
    .maybeSingle();

  if (error || !org) {
    console.error(`No organization with slug "${arg}"`);
    process.exit(1);
  }
  if (!org.github_token) {
    console.error(`Organization "${arg}" has no GitHub token configured.`);
    process.exit(1);
  }

  await runSync({
    orgId: org.id,
    githubOrg: org.github_org,
    githubToken: org.github_token,
  });
}

if (require.main === module) {
  cli().catch(() => process.exit(1));
}
