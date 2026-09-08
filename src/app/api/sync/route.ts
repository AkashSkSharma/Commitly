import { NextRequest, NextResponse } from "next/server";

/**
 * Triggers the GitHub -> Supabase sync. Called by the Vercel Cron job
 * defined in vercel.json (daily). Protect it with CRON_SECRET so it
 * can't be hit by anyone who finds the URL.
 *
 * The actual sync logic lives in scripts/sync-github.ts and is
 * duplicated here at a high level rather than imported directly,
 * because Next.js route handlers run in a serverless function with a
 * time limit — for a large org, prefer running the script via a
 * scheduled GitHub Action or a longer-running Vercel Cron with
 * `maxDuration` instead. This route is wired up for smaller orgs where
 * a single run comfortably finishes in time.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { main, errorMessage } = await import("../../../../scripts/sync-github");
  try {
    const result = await main();
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    return NextResponse.json(
      { ok: false, error: errorMessage(err) },
      { status: 500 }
    );
  }
}

export const maxDuration = 300; // seconds — bump on Pro/Enterprise if needed
