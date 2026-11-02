"use client";

import type { Health, IntegrationSummary } from "@personalos/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, CalendarDays, ChevronRight, FlaskConical, MessageSquare, Mic, Plug } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton, StatusDot } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, greeting } from "@/lib/utils";

type Tone = "ok" | "warn" | "danger" | "neutral";
type StatusInfo = { label: string; detail: string; tone: Tone };

function assistantStatus(h: Health | undefined): StatusInfo | null {
  if (!h) return null;
  if (h.gateway === "connected") return { label: "Online", detail: "Ready for questions", tone: "ok" };
  if (h.gateway === "connecting" || h.gateway === "reconnecting") return { label: "Reconnecting", detail: "Back in a moment", tone: "warn" };
  return { label: "Offline", detail: h.gateway === "pairing_required" ? "Runtime needs pairing" : "Runtime unreachable", tone: "danger" };
}
function voiceStatus(h: Health | undefined): StatusInfo | null {
  if (!h) return null;
  return h.voice === "ok" ? { label: "Ready", detail: "English and Tamil", tone: "ok" } : { label: "Not set up", detail: "Speech service not configured", tone: "neutral" };
}
function calendarStatus(c: IntegrationSummary | undefined): StatusInfo | null {
  if (!c) return null;
  if (c.status === "connected") return { label: "Connected", detail: c.accountEmail ?? "Microsoft 365", tone: "ok" };
  if (c.status === "needs_reconnect") return { label: "Needs reconnect", detail: "Access expired", tone: "warn" };
  return c.available ? { label: "Not connected", detail: "Microsoft 365, read-only", tone: "neutral" } : { label: "Not set up", detail: "Needs server configuration", tone: "neutral" };
}

export function HomeView() {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: api.integrations });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });

  const calendar = integrations.data?.items.find((i) => i.provider === "microsoft-calendar");
  const tz = me.data?.preference.timezone;
  const today = tz ? new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date()) : null;
  const firstName = me.data?.displayName.split(" ")[0];

  const statuses = [
    { key: "assistant", title: "Assistant", icon: Bot, info: assistantStatus(health.data) },
    { key: "voice", title: "Voice", icon: Mic, info: voiceStatus(health.data) },
    { key: "calendar", title: "Calendar", icon: CalendarDays, info: calendarStatus(calendar) },
  ];

  const next: { href: string; title: string; detail: string; icon: React.ComponentType<{ className?: string }>; primary?: boolean }[] = [];
  if (calendar?.status === "connected") {
    next.push({ href: `/assistant?prompt=${encodeURIComponent("What meetings do I have today?")}`, title: "Get today's meetings", detail: "Your assistant reads your calendar (read-only) and summarises it", icon: CalendarDays, primary: true });
  } else if (calendar?.status === "needs_reconnect") {
    next.push({ href: "/connections", title: "Reconnect your calendar", detail: "Microsoft 365 access expired", icon: Plug, primary: true });
  } else {
    next.push({ href: "/connections", title: "Connect your calendar", detail: calendar?.available === false ? "See what's needed to set up Microsoft 365" : "Microsoft 365, read-only. See the exact permissions first", icon: Plug, primary: true });
  }
  next.push({ href: "/assistant", title: "Ask by voice or text", detail: "Hold the mic and speak in English or Tamil; review before sending", icon: MessageSquare });
  next.push({ href: "/demo", title: "Explore the demo workspace", detail: "Morning briefing, follow-ups and a lunch-order approval with sample data", icon: FlaskConical });

  const recent = conversations.data?.items.slice(0, 5) ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 md:py-10">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            {today ? <p className="text-caption text-ink-2">{today}</p> : <Skeleton className="h-5 w-40" />}
            <Badge tone="accent" icon={<StatusDot tone="accent" />}>
              Connected mode
            </Badge>
          </div>
          <h1 className="mt-2 text-display">{me.data ? `${greeting()}${firstName ? `, ${firstName}` : ""}.` : <Skeleton className="h-9 w-72" />}</h1>
          <p className="mt-1 max-w-2xl text-ink-2">Here&apos;s where your assistant stands and what you can do next. Everything on this page is live.</p>
        </header>

        {health.isError && <ErrorState title="Couldn't reach PersonalOS" message="Status is unavailable. Check that the API is running." onRetry={() => void health.refetch()} />}

        <section aria-labelledby="status-h">
          <h2 id="status-h" className="sr-only">
            Status
          </h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {statuses.map(({ key, title, icon: Icon, info }) => (
              <Card as="li" key={key} className="flex items-center gap-3 p-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-label text-ink-3">{title}</p>
                  {info ? (
                    <>
                      <p className="flex items-center gap-2 text-heading">
                        <StatusDot tone={info.tone === "neutral" ? "neutral" : info.tone} /> {info.label}
                      </p>
                      <p className="truncate text-caption text-ink-2">{info.detail}</p>
                    </>
                  ) : (
                    <Skeleton className="mt-1 h-5 w-24" />
                  )}
                </div>
              </Card>
            ))}
          </ul>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card aria-labelledby="next-h">
            <CardHeader id="next-h" title="Next actions" description="Suggestions based on what's connected." />
            <ul className="divide-y divide-line border-t border-line">
              {next.map((n) => (
                <li key={n.title}>
                  <Link href={n.href} className="group flex min-h-16 items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2">
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", n.primary ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2")}>
                      <n.icon className="h-[18px] w-[18px]" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-heading text-ink">{n.title}</p>
                      <p className="text-caption text-ink-2">{n.detail}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>

          <Card aria-labelledby="recent-h">
            <CardHeader
              id="recent-h"
              title="Recent conversations"
              action={
                <Link href="/assistant" className={buttonClass({ variant: "ghost", size: "sm" })}>
                  Open assistant <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              }
            />
            <div className="px-3 pb-3">
              {conversations.isLoading ? (
                <div className="space-y-2 px-2" role="status" aria-label="Loading conversations">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ) : conversations.isError ? (
                <ErrorState message="Couldn't load conversations." onRetry={() => void conversations.refetch()} />
              ) : recent.length === 0 ? (
                <EmptyState icon={<MessageSquare />} title="No conversations yet" description="Ask your first question by voice or text." />
              ) : (
                <ul>
                  {recent.map((c) => (
                    <li key={c.id}>
                      <Link href={`/assistant?c=${c.id}`} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-caption text-ink hover:bg-surface-2">
                        <MessageSquare className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                        <span className="truncate">{c.title ?? "New conversation"}</span>
                        {c.lastMessageAt && <span className="ml-auto shrink-0 text-label font-normal text-ink-3">{relativeDay(c.lastMessageAt)}</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}
