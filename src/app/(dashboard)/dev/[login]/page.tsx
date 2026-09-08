import { notFound } from "next/navigation";
import { getDeveloperDetail } from "@/lib/metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default async function DeveloperDetailPage({
  params,
}: {
  params: Promise<{ login: string }>;
}) {
  const { login } = await params;
  const detail = await getDeveloperDetail(login);

  if (!detail) notFound();

  const { dev, prs, comments } = detail;
  type Pr = (typeof prs)[number];
  type Comment = (typeof comments)[number];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {dev.avatar_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dev.avatar_url}
            alt={dev.github_login}
            className="h-12 w-12 rounded-full"
          />
        )}
        <div>
          <h1 className="text-2xl font-semibold">
            {dev.display_name ?? dev.github_login}
          </h1>
          <p className="text-sm text-neutral-400">@{dev.github_login}</p>
        </div>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base">Recent pull requests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {prs.map((pr: Pr) => (
            <div
              key={pr.id}
              className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0"
            >
              <div>
                <p className="text-sm">
                  <span className="text-neutral-500">
                    {pr.repositories?.[0]?.full_name ?? "repo"}#{pr.github_pr_number}
                  </span>{" "}
                  {pr.title}
                </p>
                <p className="text-xs text-neutral-500">
                  opened {pr.opened_at && format(new Date(pr.opened_at), "MMM d, yyyy")}
                  {pr.merged_at &&
                    ` · merged ${format(new Date(pr.merged_at), "MMM d, yyyy")}`}
                  {" · "}+{pr.additions}/-{pr.deletions}
                </p>
              </div>
              <Badge
                variant={
                  pr.state === "merged"
                    ? "default"
                    : pr.state === "open"
                    ? "secondary"
                    : "outline"
                }
              >
                {pr.state}
              </Badge>
            </div>
          ))}
          {prs.length === 0 && (
            <p className="text-sm text-neutral-500">No PRs in range.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base">Recent review / testing comments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {comments.map((c: Comment, i: number) => (
            <div key={i} className="border-b border-white/5 pb-3 last:border-0">
              <p className="text-sm text-neutral-300 line-clamp-2">{c.body}</p>
              <p className="text-xs text-neutral-500">
                on {c.pull_requests?.[0]?.title ?? "a PR"}
                {c.is_testing_related && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    testing
                  </Badge>
                )}
              </p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-neutral-500">No comments in range.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
