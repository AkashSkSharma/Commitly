"use client";

import { useState, useTransition } from "react";
import { createOrganization } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function OnboardingForm() {
  const [orgName, setOrgName] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createOrganization({ orgName, githubOrg, githubToken });
      if (!result.ok) setError(result.error);
      // On success the action itself redirects to /dashboard.
    });
  }

  return (
    <Card className="w-full max-w-md border-white/10 bg-white/5">
      <CardHeader>
        <CardTitle className="text-xl">Set up your workspace</CardTitle>
        <CardDescription className="text-neutral-400">
          Two minutes: name your team, connect GitHub, and you&apos;ll see
          real activity on the next screen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              placeholder="Acme Inc"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="githubOrg">GitHub org or username</Label>
            <Input
              id="githubOrg"
              placeholder="acme-corp"
              value={githubOrg}
              onChange={(e) => setGithubOrg(e.target.value)}
              required
            />
            <p className="text-xs text-neutral-500">
              Whatever comes after github.com/ for your team&apos;s repos.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="githubToken">GitHub token</Label>
            <Input
              id="githubToken"
              type="password"
              placeholder="github_pat_..."
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              required
            />
            <p className="text-xs text-neutral-500">
              A fine-grained token scoped to this org, read-only on
              Contents, Pull requests, and Metadata.{" "}
              <a
                href="https://github.com/settings/personal-access-tokens/new"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Create one
              </a>
              . We only ever use it server-side to read PR/review/commit
              activity — never exposed to your browser or your teammates.
            </p>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? "Connecting..." : "Connect and see your dashboard"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
