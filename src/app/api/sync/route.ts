import { NextRequest, NextResponse } from "next/server";

/**
 * Triggers a GitHub -> Supabase sync for every organization. Called by
 * the Vercel Cron job defined in vercel.json (daily). Protected by
 * CRON_SECRET so it can't be hit by anyone who finds the URL.
 *
 * The actual sync logic lives in scripts/sync-github.ts and is imported
 * here rather than duplicated. For a large number of organizations,
 * prefer fanning this out (one invocation per org, e.g. via a queue)
 * over one long-running loop — see the `maxDuration` note below.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runSyncForAllOrgs } = await import("../../../../scripts/sync-github");
  try {
    const results = await runSyncForAllOrgs();
    return NextResponse.json({ ok: true, results });
  } catch (err: unknown) {
    const { errorMessage } = await import("../../../../scripts/sync-github");
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // seconds — bump on Pro/Enterprise, or fan out per-org
