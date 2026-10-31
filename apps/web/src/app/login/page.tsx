"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api.login({ email: String(form.get("email")), password: String(form.get("password")) });
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not sign in. Try again.");
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-5 h-12 w-12 rounded-2xl bg-accent shadow-[0_8px_30px_-8px_var(--accent)]" aria-hidden />
          <h1 className="font-display text-3xl tracking-tight">Welcome back</h1>
          <p className="mt-2 text-ink-2">Sign in to your personal assistant.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-3xl border border-line bg-surface p-6 shadow-sm">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Email</span>
            <input name="email" type="email" autoComplete="username" required className="h-11 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">Password</span>
            <input name="password" type="password" autoComplete="current-password" required className="h-11 w-full rounded-xl border border-line bg-bg px-3 outline-none focus:border-accent" />
          </label>
          {error && (
            <p role="alert" className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full justify-center" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
