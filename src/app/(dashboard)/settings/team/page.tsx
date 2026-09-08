import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TeamManager } from "./team-manager";

export default async function TeamSettingsPage() {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  if (org.role !== "admin") redirect("/dashboard");

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("org_members")
    .select("id, email, role, user_id, created_at")
    .eq("org_id", org.orgId)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-neutral-400">
          Anyone you add here can sign in to {org.name}&apos;s dashboard with
          a magic link — no separate account creation needed.
        </p>
      </div>

      <Card className="border-white/10 bg-white/5">
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            {members?.length ?? 0} {members?.length === 1 ? "person" : "people"} with access
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TeamManager
            members={(members ?? []).map((m) => ({
              id: m.id,
              email: m.email,
              role: m.role,
              hasLoggedIn: !!m.user_id,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
