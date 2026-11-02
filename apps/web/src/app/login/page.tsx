"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { Field, fieldClass } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { hasSeenWelcome } from "@/lib/onboarding";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in (valid cookie)? Go to the app. A stale cookie gets a 401 and is cleared by the API.
  useEffect(() => {
    let cancelled = false;
    api.me().then(
      () => !cancelled && router.replace("/"),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      await api.login({ email: String(form.get("email")), password: String(form.get("password")) });
      router.replace(hasSeenWelcome() ? "/" : "/welcome");
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : "Could not sign in. Try again.");
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <Logo />
          <h1 className="mt-8 text-display">Sign in</h1>
          <p className="mt-1 text-ink-2">Welcome back to your assistant.</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-line bg-surface p-6 shadow-e1">
          <Field label="Email">
            <input name="email" type="email" autoComplete="username" required className={fieldClass} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autoComplete="current-password" required className={fieldClass} />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-caption text-danger">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}
