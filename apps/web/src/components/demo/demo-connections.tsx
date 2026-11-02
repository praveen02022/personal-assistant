"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Contact, IndianRupee, MessageCircle, Plug, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import { PermissionColumns } from "@/components/connections/connections";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, ErrorState, LoadingRows, Notice, PageHeader, SampleBadge } from "@/components/ui/primitives";
import { api } from "@/lib/api";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { calendar: CalendarDays, crm: Contact, payments: IndianRupee, messaging: MessageCircle, ordering: UtensilsCrossed };

export function DemoConnections() {
  const ws = useQuery({ queryKey: ["demo-workspace"], queryFn: api.demo.workspace });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-6 md:py-10">
        <PageHeader
          eyebrow={<SampleBadge>Simulated services</SampleBadge>}
          title="Connections"
          description="The services this demo pretends to use, and the access a real connection would need. None of them is connected."
          actions={
            <Link href="/connections" className={buttonClass({ variant: "secondary", size: "sm" })}>
              <Plug className="h-4 w-4" aria-hidden /> Your real connections
            </Link>
          }
        />
        <Notice tone="demo" role="note">
          In demo mode PersonalOS doesn&apos;t touch any account. The server&apos;s demo service has no access to your calendar, the assistant runtime or the internet, and approvals only change sample records.
        </Notice>
        {ws.isLoading && <LoadingRows rows={3} label="Loading services" />}
        {ws.isError && <ErrorState title="Couldn't load the demo" message="The demo service didn't respond." onRetry={() => void ws.refetch()} />}
        <div className="grid gap-3 md:grid-cols-2">
          {ws.data?.services.map((s) => {
            const Icon = ICONS[s.id] ?? Plug;
            return (
              <Card key={s.id} className="p-5">
                <div className="flex items-start gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-heading">{s.name}</h2>
                      <Badge tone="demo">Simulated · not connected</Badge>
                    </div>
                    <p className="mt-1 text-caption text-ink-2">{s.purpose}</p>
                  </div>
                </div>
                <PermissionColumns
                  allowed={s.access.map((text) => ({ text }))}
                  never={["Act without your approval", "Share data outside PersonalOS"]}
                  allowedTitle="Access a real connection would need"
                  neverTitle="Never"
                />
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
