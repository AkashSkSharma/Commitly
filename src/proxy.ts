import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes reachable without a logged-in user.
const PUBLIC_PATHS = ["/login", "/auth/callback", "/setup"];
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Supabase isn't configured yet (fresh local checkout, no .env.local) —
  // send everyone to a friendly setup page instead of crashing on every
  // request. This is what makes `npm run dev` work immediately after
  // `git clone`, before anyone has created a Supabase project.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    if (pathname === "/setup") return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!data.user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (data.user && (pathname === "/login" || pathname === "/setup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Whether a logged-in user belongs to an org yet is checked in
  // src/app/(dashboard)/layout.tsx and src/app/onboarding/page.tsx
  // themselves (a DB round trip doesn't belong in the proxy hot path
  // for every request) — they redirect between /dashboard and
  // /onboarding as needed.

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets and Next.js internals.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
