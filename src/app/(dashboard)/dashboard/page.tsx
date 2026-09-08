import Link from "next/link";
import { getTeamSummary, getLastSyncRun } from "@/lib/metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

function formatHours(h: number | null) {
  if (h === null) return "—";
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window } = await searchParams;
  const windowDays = Number(window ?? 30);

  const [team, lastSync] = await Promise.all([
    getTeamSummary(windowDays),
    getLastSyncRun(),
  ]);

  const sortedTeam = [...team].sort((a, b) => b.prsMerged - a.prsMerged);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Team progress</h1>
          <p className="text-sm text-neutral-400">
            Last {windowDays} days · GitHub activity across all tracked repos
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          {[7, 30, 90].map((d) => (
            <Link
              key={d}
              href={`/dashboard?window=${d}`}
              className={`rounded-md px-3 py-1 ${
                d === windowDays
                  ? "bg-white text-black"
                  : "bg-white/5 text-neutral-300 hover:bg-white/10"
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      {lastSync && (
        <p className="text-xs text-neutral-500">
          Last synced{" "}
          {formatDistanceToNow(new Date(lastSync.started_at), {
            addSuffix: true,
          })}{" "}
          · {lastSync.status}
          {lastSync.status === "failed" && lastSync.error
            ? ` — ${lastSync.error}`
            : ""}
        </p>
      )}

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base">By developer</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Developer</TableHead>
                <TableHead className="text-right">PRs opened</TableHead>
                <TableHead className="text-right">PRs merged</TableHead>
                <TableHead className="text-right">Avg time to merge</TableHead>
                <TableHead className="text-right">Avg review turnaround</TableHead>
                <TableHead className="text-right">Reviews given</TableHead>
                <TableHead className="text-right">Testing comments</TableHead>
                <TableHead className="text-right">Commits</TableHead>
                <TableHead className="text-right">Active days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedTeam.map((dev) => (
                <TableRow key={dev.id}>
                  <TableCell>
                    <Link
                      href={`/dev/${dev.githubLogin}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      {dev.avatarUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={dev.avatarUrl}
                          alt={dev.githubLogin}
                          className="h-6 w-6 rounded-full"
                        />
                      )}
                      <span>{dev.displayName ?? dev.githubLogin}</span>
                      {dev.team && (
                        <Badge variant="secondary" className="ml-1 text-xs">
                          {dev.team}
                        </Badge>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{dev.prsOpened}</TableCell>
                  <TableCell className="text-right">{dev.prsMerged}</TableCell>
                  <TableCell className="text-right">
                    {formatHours(dev.avgTimeToMergeHours)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatHours(dev.avgReviewTurnaroundHours)}
                  </TableCell>
                  <TableCell className="text-right">{dev.reviewsGiven}</TableCell>
                  <TableCell className="text-right">
                    {dev.testingComments}
                  </TableCell>
                  <TableCell className="text-right">{dev.commits}</TableCell>
                  <TableCell className="text-right">{dev.activeDays}</TableCell>
                </TableRow>
              ))}
              {sortedTeam.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-neutral-500">
                    No activity yet — run the sync script to pull GitHub data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
