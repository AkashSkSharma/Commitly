"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type SendMagicLinkResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Sends a Supabase magic link ONLY if the email is present in
 * `allowed_managers`. This is the gate that keeps the dashboard
 * manager-only while still being one click for the manager themselves
 * (no password, no separate account creation step).
 */
export async function sendMagicLink(
  email: string
): Promise<SendMagicLinkResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { ok: false, error: "Enter an email address." };
  }

  const admin = createAdminClient();
  const { data: allowed, error: allowlistError } = await admin
    .from("allowed_managers")
    .select("email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (allowlistError) {
    return { ok: false, error: "Could not verify access. Try again." };
  }

  if (!allowed) {
    // Deliberately vague — don't reveal whether the address was ever
    // considered, just that it isn't authorized.
    return {
      ok: false,
      error: "This email isn't authorized to view the dashboard.",
    };
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
