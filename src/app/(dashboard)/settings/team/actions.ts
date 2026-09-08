"use server";

import { getCurrentOrg } from "@/lib/org";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

export type InviteResult = { ok: true } | { ok: false; error: string };

export async function inviteMember(email: string): Promise<InviteResult> {
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization." };
  if (org.role !== "admin") {
    return { ok: false, error: "Only admins can invite teammates." };
  }

  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return { ok: false, error: "Enter a valid email." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("org_members").insert({
    org_id: org.orgId,
    email: normalized,
    role: "manager",
    invited_by_email: org.name,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "That email is already invited." };
    }
    return { ok: false, error: "Could not add that email. Try again." };
  }

  revalidatePath("/settings/team");
  return { ok: true };
}

export async function removeMember(memberId: number): Promise<InviteResult> {
  const org = await getCurrentOrg();
  if (!org) return { ok: false, error: "No organization." };
  if (org.role !== "admin") {
    return { ok: false, error: "Only admins can remove teammates." };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("org_members")
    .delete()
    .eq("id", memberId)
    .eq("org_id", org.orgId);

  if (error) return { ok: false, error: "Could not remove that member." };

  revalidatePath("/settings/team");
  return { ok: true };
}
