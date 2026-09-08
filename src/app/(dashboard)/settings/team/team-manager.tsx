"use client";

import { useState, useTransition } from "react";
import { inviteMember, removeMember } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Member = {
  id: number;
  email: string;
  role: string;
  hasLoggedIn: boolean;
};

export function TeamManager({ members }: { members: Member[] }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await inviteMember(email);
      if (!result.ok) setError(result.error);
      else setEmail("");
    });
  }

  function handleRemove(id: number) {
    startTransition(async () => {
      await removeMember(id);
    });
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleInvite} className="flex gap-2">
        <Input
          type="email"
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" disabled={isPending}>
          Invite
        </Button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="divide-y divide-white/5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2 text-sm">
              <span>{m.email}</span>
              <Badge variant="secondary" className="text-xs">
                {m.role}
              </Badge>
              {!m.hasLoggedIn && (
                <Badge variant="outline" className="text-xs text-neutral-400">
                  invited · hasn&apos;t signed in
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={isPending}
              onClick={() => handleRemove(m.id)}
            >
              Remove
            </Button>
          </div>
        ))}
        {members.length === 0 && (
          <p className="py-2 text-sm text-neutral-500">No teammates yet.</p>
        )}
      </div>
    </div>
  );
}
