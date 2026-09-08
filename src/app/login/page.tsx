"use client";

import { useState, useTransition } from "react";
import { sendMagicLink } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    { kind: "idle" } | { kind: "sent" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await sendMagicLink(email);
      if (result.ok) {
        setStatus({ kind: "sent" });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-black">
      <div
        className="absolute inset-0 h-full w-full opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 20%, rgba(99,102,241,0.35), transparent 40%), radial-gradient(circle at 80% 0%, rgba(236,72,153,0.25), transparent 40%), radial-gradient(circle at 50% 100%, rgba(16,185,129,0.25), transparent 40%)",
        }}
      />
      <div
        className="absolute inset-0 h-full w-full [background-size:32px_32px] opacity-[0.15]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #ffffff22 1px, transparent 1px), linear-gradient(to bottom, #ffffff22 1px, transparent 1px)",
        }}
      />

      <Card className="relative z-10 w-full max-w-sm border-white/10 bg-white/5 backdrop-blur-xl text-white">
        <CardHeader>
          <CardTitle className="text-xl">Commitly</CardTitle>
          <CardDescription className="text-white/60">
            Sign in with your manager email to get a magic link — no
            password needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status.kind === "sent" ? (
            <p className="text-sm text-green-400">
              Check your inbox — click the link we sent to {email} to sign in.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@zopping.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                />
              </div>
              {status.kind === "error" && (
                <p className="text-sm text-red-400">{status.message}</p>
              )}
              <Button type="submit" disabled={isPending} className="w-full">
                {isPending ? "Sending link..." : "Send magic link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
