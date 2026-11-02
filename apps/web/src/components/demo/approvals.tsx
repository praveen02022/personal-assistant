"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { EmptyState, ErrorState, LoadingRows, PageHeader, SampleBadge } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { ApprovalCard } from "./approval-card";

export function DemoApprovals() {
  const ws = useQuery({ queryKey: ["demo-workspace"], queryFn: api.demo.workspace });
  const actions = ws.data?.actions ?? [];
  const waiting = actions.filter((a) => a.status === "proposed");
  const done = actions.filter((a) => a.status !== "proposed");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6 md:py-10">
        <PageHeader
          eyebrow={<SampleBadge>Simulated actions</SampleBadge>}
          title="Approvals"
          description="Your assistant proposes; you decide. Nothing happens until you approve, and in this demo nothing real happens even then."
        />
        {ws.isLoading && <LoadingRows rows={3} label="Loading approvals" />}
        {ws.isError && <ErrorState title="Couldn't load approvals" message="The demo service didn't respond." onRetry={() => void ws.refetch()} />}

        {ws.data && (
          <>
            <section aria-labelledby="waiting-h" className="space-y-3">
              <h2 id="waiting-h" className="text-heading">
                Waiting for you <span className="font-normal text-ink-2 tabular">({waiting.length})</span>
              </h2>
              {waiting.length === 0 ? (
                <EmptyState icon={<ClipboardCheck />} title="You're all caught up" description="New proposals from your assistant will appear here." />
              ) : (
                waiting.map((a) => <ApprovalCard key={a.id} action={a} />)
              )}
            </section>
            <section aria-labelledby="history-h" className="space-y-3">
              <h2 id="history-h" className="text-heading">
                History
              </h2>
              {done.map((a) => (
                <ApprovalCard key={a.id} action={a} />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
