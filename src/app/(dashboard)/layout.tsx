import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="font-semibold tracking-tight">
              Commitly
            </Link>
            <span className="text-neutral-600">/</span>
            <span className="text-sm text-neutral-400">{org.name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-neutral-400">
            {org.role === "admin" && (
              <Link href="/settings/team" className="hover:text-neutral-200">
                Team
              </Link>
            )}
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
