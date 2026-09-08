"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUniqueSlug } from "@/lib/org";
import { redirect } from "next/navigation";

export type CreateOrgResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createOrganization(input: {
  orgName: string;
  githubOrg: string;
  githubToken: string;
}): Promise<CreateOrgResult> {
  const orgName = input.orgName.trim();
  const githubOrg = input.githubOrg.trim().replace(/^https?:\/\/github\.com\//, "");
  const githubToken = input.githubToken.trim();

  if (!orgName || !githubOrg || !githubToken) {
    return { ok: false, error: "All fields are required." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    return { ok: false, error: "You need to be signed in." };
  }

  // Sanity-check the token before we save it: a bad/expired token should
  // fail here with a clear message, not silently produce an empty
  // dashboard later.
  const probe = await fetch(`https://api.github.com/orgs/${githubOrg}`, {
    headers: { Authorization: `token ${githubToken}` },
  });
  if (probe.status === 404) {
    return {
      ok: false,
      error: `GitHub org "${githubOrg}" not found (or the token can't see it).`,
    };
  }
  if (probe.status === 401) {
    return { ok: false, error: "That GitHub token was rejected — check it's not expired." };
  }
  if (!probe.ok) {
    return { ok: false, error: `GitHub API error (${probe.status}) — try again.` };
  }

  const admin = createAdminClient();
  const slug = await generateUniqueSlug(orgName);

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({
      name: orgName,
      slug,
      github_org: githubOrg,
      github_token: githubToken,
      created_by_email: user.email,
    })
    .select("id")
    .single();

  if (orgError || !org) {
    return { ok: false, error: "Could not create the organization. Try again." };
  }

  const { error: memberError } = await admin.from("org_members").insert({
    org_id: org.id,
    email: user.email.toLowerCase(),
    user_id: user.id,
    role: "admin",
    invited_by_email: user.email,
  });

  if (memberError) {
    return { ok: false, error: "Organization created, but adding you as admin failed. Contact support." };
  }

  // Kick off the first sync inline so the dashboard has data the moment
  // onboarding finishes. If this fails (rate limit, big org, etc.) it's
  // not fatal — the daily cron (or a manual re-run) will pick it up;
  // we just log it rather than blocking the redirect.
  try {
    const { runSync } = await import("../../../scripts/sync-github");
    await runSync({ orgId: org.id, githubOrg, githubToken });
  } catch (err) {
    console.error("Initial sync failed during onboarding:", err);
  }

  redirect("/dashboard");
}
