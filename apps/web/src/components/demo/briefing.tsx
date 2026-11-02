"use client";

import type { DemoScheduleItem } from "@personalos/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, CalendarDays, MessageSquare, Phone, Sparkles, Users } from "lucide-react";
import Link from "next/link";
import { SourceList } from "@/components/chat/messages";
import { buttonClass } from "@/components/ui/button";
import { ActionStatusBadge, Card, CardHeader, EmptyState, ErrorState, LoadingRows, SampleBadge, Skeleton } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { cn, greeting } from "@/lib/utils";
import { inr } from "./approval-card";

const KIND_ICON: Record<DemoScheduleItem["kind"], React.ComponentType<{ className?: string }>> = { visit: Building2, registration: CalendarDays, call: Phone, team: Users };

export const DEMO_PROMPTS = ["Give me my morning briefing", "What follow-ups are pending?", "Order lunch for the team", "Which payments are due?"];

export function DemoBriefing() {
  const ws = useQuery({ queryKey: ["demo-workspace"], queryFn: api.demo.workspace });
  const d = ws.data;
  const pending = d?.actions.filter((a) => a.status === "proposed") ?? [];

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 md:py-10">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            {d ? <p className="text-caption text-ink-2">{d.briefing.dateLabel}</p> : <Skeleton className="h-5 w-40" />}
            <SampleBadge />
            {d && <span className="text-caption text-ink-2">{d.business.name}</span>}
          </div>
          <h1 className="mt-2 text-display">{d ? `${greeting()}. Here's your briefing for today.` : "Your morning briefing"}</h1>
          {d ? <p className="mt-1 max-w-2xl text-ink-2">{d.briefing.headline}</p> : <Skeleton className="mt-2 h-5 w-96 max-w-full" />}
        </header>

        {ws.isError && <ErrorState title="Couldn't load the demo" message="The demo service didn't respond." onRetry={() => void ws.refetch()} />}
        {ws.isLoading && <LoadingRows rows={3} label="Loading sample briefing" />}

        {d && (
          <>
            <section aria-labelledby="highlights-h">
              <h2 id="highlights-h" className="sr-only">
                Highlights
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {d.briefing.highlights.map((h) => (
                  <Card as="li" key={h.label} className="p-4">
                    <p className="text-label font-normal text-ink-2">{h.label}</p>
                    <p className={cn("mt-1 text-title tabular", h.tone === "attention" ? "text-warn" : h.tone === "good" ? "text-ok" : "text-ink")}>{h.value}</p>
                    <p className="text-caption text-ink-2">{h.detail}</p>
                  </Card>
                ))}
              </ul>
            </section>

            <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
              <Card aria-labelledby="schedule-h">
                <CardHeader id="schedule-h" title="Today's schedule" description="From the sample calendar" />
                <ol className="px-5 pb-2">
                  {d.briefing.schedule.map((s) => {
                    const Icon = KIND_ICON[s.kind];
                    return (
                      <li key={s.time} className="flex gap-4 border-t border-line py-3 first:border-t-0">
                        <span className="w-[4.5rem] shrink-0 pt-0.5 text-caption font-medium text-ink tabular">{s.time}</span>
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-caption font-medium text-ink">{s.title}</p>
                          <p className="text-caption text-ink-2">{s.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <div className="border-t border-line px-5 pb-4">
                  <SourceList items={d.briefing.sources.map((s) => ({ label: s.label, detail: s.detail, kind: "sample" }))} />
                </div>
              </Card>

              <div className="space-y-6">
                <Card aria-labelledby="approvals-h">
                  <CardHeader
                    id="approvals-h"
                    title="Waiting for your approval"
                    description={pending.length ? `${pending.length} proposed by your assistant` : "You're all caught up"}
                    action={
                      <Link href="/demo/approvals" className={buttonClass({ variant: "ghost", size: "sm" })}>
                        Review <ArrowRight className="h-4 w-4" aria-hidden />
                      </Link>
                    }
                  />
                  <div className="px-3 pb-3">
                    {pending.length === 0 ? (
                      <EmptyState title="Nothing waiting" description="Approved and declined actions are in Approvals." />
                    ) : (
                      <ul>
                        {pending.map((a) => (
                          <li key={a.id}>
                            <Link href="/demo/approvals" className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-2">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-caption font-medium text-ink">{a.title}</p>
                                <p className="truncate text-label font-normal text-ink-2">{a.order ? `${inr(a.order.total)} · ${a.order.vendor}` : `To ${a.recipient?.name} · ${a.recipient?.channel}`}</p>
                              </div>
                              <ActionStatusBadge status={a.status} />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                <Card aria-labelledby="ask-h">
                  <CardHeader id="ask-h" title="Ask your assistant" description="Type or speak. Answers come from the sample data." icon={<Sparkles className="h-[18px] w-[18px]" aria-hidden />} />
                  <ul className="space-y-2 px-5 pb-5">
                    {DEMO_PROMPTS.map((p) => (
                      <li key={p}>
                        <Link
                          href={`/demo/assistant?ask=${encodeURIComponent(p)}`}
                          className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3 py-2 text-caption text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
                        >
                          <MessageSquare className="h-4 w-4 shrink-0 text-ink-3" aria-hidden /> {p}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
