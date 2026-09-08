import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SetupPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <Card className="w-full max-w-lg border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle>Commitly isn&apos;t configured yet</CardTitle>
          <CardDescription className="text-neutral-400">
            This is a fresh checkout — Supabase env vars aren&apos;t set, so
            there&apos;s no login or data to show.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-neutral-300">
          <p>To get running:</p>
          <ol className="list-inside list-decimal space-y-2">
            <li>Create a Supabase project and run the migrations in <code className="rounded bg-white/10 px-1">supabase/migrations/</code>.</li>
            <li>
              Copy <code className="rounded bg-white/10 px-1">.env.example</code> to{" "}
              <code className="rounded bg-white/10 px-1">.env.local</code> and fill
              in your Supabase URL/keys and <code className="rounded bg-white/10 px-1">NEXT_PUBLIC_SITE_URL</code>.
            </li>
            <li>Restart <code className="rounded bg-white/10 px-1">npm run dev</code>.</li>
          </ol>
          <p className="pt-2 text-neutral-500">
            Full walkthrough in the project README.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
