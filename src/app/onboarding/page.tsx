import { redirect } from "next/navigation";
import { getCurrentOrg } from "@/lib/org";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const org = await getCurrentOrg();
  if (org) redirect("/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <OnboardingForm />
    </div>
  );
}
