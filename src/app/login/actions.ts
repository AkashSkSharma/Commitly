"use server";

import { createClient } from "@/lib/supabase/server";

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Sends a Supabase magic link to any email — Commitly is a public
 * product now, so signing in is open to anyone. What they can actually
 * *see* is still gated: a fresh sign-in with no organization lands on
 * /onboarding, and every dashboard query is scoped to the orgs they're
 * a member of (see src/lib/org.ts + the org-scoped RLS policies in
 * supabase/migrations/0002_multi_tenant.sql). Being invited to an org
 * ahead of time (org_members row by email) is what makes a returning
 * teammate land straight on the dashboard instead of onboarding.
 */
export async function sendMagicLink(
  email: string
): Promise<SendMagicLinkResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false, error: "Enter an email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true };
}
