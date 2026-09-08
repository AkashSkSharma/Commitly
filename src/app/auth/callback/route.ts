import { createClient } from "@/lib/supabase/server";
import { linkUserToInvites, getCurrentOrg } from "@/lib/org";
import { NextResponse, type NextRequest } from "next/server";

// Handles the redirect from the Supabase magic-link email: exchanges the
// one-time code for a session, links this user to any org invites sent
// to their email, then sends them to their dashboard — or to onboarding
// if they don't belong to an organization yet.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user?.email) {
      await linkUserToInvites(data.user.id, data.user.email);
      const org = await getCurrentOrg();
      return NextResponse.redirect(
        `${origin}${org ? "/dashboard" : "/onboarding"}`
      );
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
