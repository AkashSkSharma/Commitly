import { createClient as createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type CurrentOrg = {
  orgId: number;
  name: string;
  slug: string;
  githubOrg: string;
  role: string;
};

/**
 * Returns the signed-in user's organization (v1: one org per user — the
 * first membership row). Null means: logged in, but hasn't finished
 * onboarding yet (no org_members row linked to their user_id).
 *
 * Only selects the columns a browser-adjacent page should ever see —
 * never `github_token`, which stays admin-client-only.
 */
export async function getCurrentOrg(): Promise<CurrentOrg | null> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("org_members")
    .select("role, organizations(id, name, slug, github_org)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const org = (membership?.organizations as unknown as
    | { id: number; name: string; slug: string; github_org: string }
    | { id: number; name: string; slug: string; github_org: string }[]
    | null);
  const orgRow = Array.isArray(org) ? org[0] : org;
  if (!membership || !orgRow) return null;

  return {
    orgId: orgRow.id,
    name: orgRow.name,
    slug: orgRow.slug,
    githubOrg: orgRow.github_org,
    role: membership.role,
  };
}

/**
 * Links the just-authenticated user's auth.uid() to any org_members
 * rows invited by their email that aren't linked yet. Call this right
 * after a magic-link sign-in completes (the auth callback route) — it's
 * what turns "we invited jane@co.com" into "jane is actually in".
 */
export async function linkUserToInvites(userId: string, email: string) {
  const admin = createAdminClient();
  await admin
    .from("org_members")
    .update({ user_id: userId })
    .eq("email", email.toLowerCase())
    .is("user_id", null);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function generateUniqueSlug(name: string): Promise<string> {
  const admin = createAdminClient();
  const base = slugify(name) || "org";
  let candidate = base;
  let suffix = 1;

  while (true) {
    const { data } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}
