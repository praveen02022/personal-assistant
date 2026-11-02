"use client";

import { ArrowRight, CalendarDays, ClipboardCheck, FlaskConical, Mic, Plug, ShieldCheck, Sunrise } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { markWelcomeSeen } from "@/lib/onboarding";

/** Guided welcome: two clear paths. Choosing either remembers that the welcome was seen. */
export default function WelcomePage() {
  return (
    <main className="min-h-dvh overflow-y-auto px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        <Logo />
        <div className="mt-12 max-w-2xl">
          <h1 className="text-display sm:text-[2.25rem] sm:leading-[2.75rem]">Welcome to PersonalOS</h1>
          <p className="mt-2 text-ink-2">A voice-first assistant for running your business day. See it working with sample data first, or set it up with your own accounts.</p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Choice
            href="/demo"
            tone="demo"
            icon={<FlaskConical className="h-5 w-5" aria-hidden />}
            title="Try the demo"
            body="A sample workspace for a real-estate office. Nothing real is sent, ordered or accessed."
            points={[
              { icon: Sunrise, text: "Morning briefing: site visits, payments, new leads" },
              { icon: Mic, text: "Ask by voice or text about follow-ups" },
              { icon: ClipboardCheck, text: "Approve a team lunch order (simulated)" },
            ]}
            cta="Open the demo"
          />
          <Choice
            href="/connections"
            tone="accent"
            icon={<Plug className="h-5 w-5" aria-hidden />}
            title="Set up my assistant"
            body="Connect your own calendar and start asking. You'll see every permission before you connect."
            points={[
              { icon: CalendarDays, text: "Microsoft 365 Calendar, read-only" },
              { icon: Mic, text: "Voice in English and Tamil, reviewed before sending" },
              { icon: ShieldCheck, text: "No messages, purchases or changes without approval" },
            ]}
            cta="Start setup"
          />
        </div>

        <p className="mt-8 text-caption text-ink-2">
          <Link href="/" onClick={markWelcomeSeen} className="font-medium text-accent underline-offset-2 hover:underline">
            Skip to Home
          </Link>
        </p>
      </div>
    </main>
  );
}

function Choice({
  href,
  tone,
  icon,
  title,
  body,
  points,
  cta,
}: {
  href: string;
  tone: "demo" | "accent";
  icon: React.ReactNode;
  title: string;
  body: string;
  points: { icon: React.ComponentType<{ className?: string }>; text: string }[];
  cta: string;
}) {
  return (
    <Link
      href={href}
      onClick={markWelcomeSeen}
      className="group flex flex-col rounded-xl border border-line bg-surface p-6 shadow-e1 transition-[border-color,box-shadow] duration-150 hover:border-line-strong hover:shadow-e2"
    >
      <div className={tone === "demo" ? "grid h-10 w-10 place-items-center rounded-lg bg-demo-soft text-demo" : "grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent-soft-ink"}>{icon}</div>
      <h2 className="mt-4 text-title">{title}</h2>
      <p className="mt-1 text-caption text-ink-2">{body}</p>
      <ul className="mt-4 flex-1 space-y-2">
        {points.map((p) => (
          <li key={p.text} className="flex items-start gap-2 text-caption text-ink">
            <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
            {p.text}
          </li>
        ))}
      </ul>
      <span className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[0.875rem] font-medium text-accent-ink shadow-e1 transition-colors group-hover:bg-accent-hover md:h-10">
        {cta} <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}
