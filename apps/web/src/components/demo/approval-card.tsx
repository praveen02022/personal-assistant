"use client";

import type { DemoAction, DemoWorkspace } from "@personalos/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed, CircleSlash, Clock3, FlaskConical, MessageCircle, UtensilsCrossed, XCircle } from "lucide-react";
import { useState } from "react";
import { SourceList } from "@/components/chat/messages";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { ActionStatusBadge, Card, Notice } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

export const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/** Approve/decline a demo action; the server decides the (simulated) outcome. */
function useDecision(action: DemoAction) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decision: "approve" | "reject") => (decision === "approve" ? api.demo.approve(action.id) : api.demo.reject(action.id)),
    onSuccess: (updated) => {
      qc.setQueryData<DemoWorkspace>(["demo-workspace"], (ws) => (ws ? { ...ws, actions: ws.actions.map((a) => (a.id === updated.id ? updated : a)) } : ws));
      void qc.invalidateQueries({ queryKey: ["demo-workspace"] });
    },
  });
}

export function ApprovalCard({ action, compact = false }: { action: DemoAction; compact?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const decision = useDecision(action);
  const isOrder = action.kind === "lunch_order";
  const Icon = isOrder ? UtensilsCrossed : MessageCircle;
  const pending = action.status === "proposed";

  return (
    <Card as="article" aria-labelledby={`action-${action.id}`} className={cn("overflow-hidden", pending && "border-line-strong")}>
      <div className="flex flex-wrap items-start gap-3 px-5 pt-4">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={`action-${action.id}`} className="text-heading">
            {action.title}
          </h3>
          <p className="text-caption text-ink-2">{action.summary}</p>
        </div>
        <ActionStatusBadge status={action.status} />
      </div>

      <div className="space-y-4 px-5 py-4">
        {isOrder && action.order ? <OrderDetails order={action.order} compact={compact} /> : <MessageDetails action={action} />}

        {action.resultNote && (
          <Notice tone={action.status === "failed" ? "danger" : action.status === "completed" ? "ok" : "info"} role="note" className="shadow-none">
            <span className="font-medium text-ink">{action.resultNote}</span>
          </Notice>
        )}

        {!compact && <Timeline action={action} />}
        {!compact && <SourceList items={action.sources.map((s) => ({ label: s.label, detail: s.detail, kind: "sample" }))} />}
      </div>

      {pending && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2/50 px-5 py-3">
          <p className="inline-flex items-center gap-1.5 text-label font-normal text-ink-2">
            <FlaskConical className="h-3.5 w-3.5 text-demo" aria-hidden /> Simulated: nothing real is {isOrder ? "ordered" : "sent"}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => decision.mutate("reject")} disabled={decision.isPending}>
              Decline
            </Button>
            <Button size="sm" onClick={() => setConfirming(true)} disabled={decision.isPending}>
              {isOrder ? `Review & approve ${inr(action.order!.total)}` : "Review & approve"}
            </Button>
          </div>
        </div>
      )}
      {decision.isError && (
        <p role="alert" className="px-5 pb-3 text-caption text-danger">
          {decision.error instanceof ApiRequestError ? decision.error.message : "Couldn't update this action."}
        </p>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={isOrder ? "Approve this lunch order?" : `Send this message to ${action.recipient?.name}?`}
        description={isOrder ? "Check the vendor, items and total before you confirm." : "Check the recipient and wording before you confirm."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                decision.mutate("approve", {
                  onSuccess: () => setConfirming(false),
                })
              }
              disabled={decision.isPending}
            >
              {decision.isPending ? "Approving…" : isOrder ? `Approve order · ${inr(action.order!.total)}` : "Approve & send"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {isOrder && action.order ? <OrderDetails order={action.order} /> : <MessageDetails action={action} />}
          <Notice tone="demo" role="note" className="shadow-none">
            <span className="font-medium text-ink">Demo:</span> {isOrder ? "no real order will be placed and no money moves." : "no real message will be sent."}
          </Notice>
        </div>
      </Dialog>
    </Card>
  );
}

function OrderDetails({ order, compact = false }: { order: NonNullable<DemoAction["order"]>; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 text-caption sm:grid-cols-2">
        <div>
          <dt className="text-label font-normal text-ink-3">Vendor</dt>
          <dd className="font-medium text-ink">{order.vendor}</dd>
        </div>
        <div>
          <dt className="text-label font-normal text-ink-3">Deliver to · by</dt>
          <dd className="font-medium text-ink">
            {order.deliverTo} · {order.deliverBy}
          </dd>
        </div>
      </dl>
      {!compact && (
        <table className="w-full text-caption tabular">
          <caption className="sr-only">Order items</caption>
          <thead>
            <tr className="border-b border-line text-left text-label text-ink-3">
              <th className="py-1.5 font-normal">Item</th>
              <th className="py-1.5 text-right font-normal">Qty</th>
              <th className="py-1.5 text-right font-normal">Price</th>
              <th className="py-1.5 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.name} className="border-b border-line">
                <td className="py-1.5 text-ink">{i.name}</td>
                <td className="py-1.5 text-right text-ink-2">{i.quantity}</td>
                <td className="py-1.5 text-right text-ink-2">{inr(i.unitPrice)}</td>
                <td className="py-1.5 text-right text-ink">{inr(i.quantity * i.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-ink-2">
            <tr>
              <td colSpan={3} className="pt-2 text-right">
                Subtotal
              </td>
              <td className="pt-2 text-right">{inr(order.subtotal)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="text-right">
                GST (5%)
              </td>
              <td className="text-right">{inr(order.taxes)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="text-right">
                Delivery
              </td>
              <td className="text-right">{inr(order.deliveryFee)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-4 py-3">
        <span className="text-caption font-medium text-ink-2">Total amount</span>
        <span className="text-title tabular text-ink">{inr(order.total)}</span>
      </div>
    </div>
  );
}

function MessageDetails({ action }: { action: DemoAction }) {
  const r = action.recipient;
  return (
    <div className="space-y-3">
      {r && (
        <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-3 text-caption font-semibold text-ink" aria-hidden>
            {r.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")}
          </span>
          <div className="min-w-0">
            <p className="text-label font-normal text-ink-3">To</p>
            <p className="text-heading text-ink">{r.name}</p>
            <p className="text-caption text-ink-2">
              {r.role} · via {r.channel} (simulated)
            </p>
          </div>
        </div>
      )}
      {action.messagePreview && <blockquote className="border-l-2 border-line-strong pl-3 text-caption text-ink">{action.messagePreview}</blockquote>}
    </div>
  );
}

const STEP_ICON = { proposed: CircleDashed, approved: Clock3, completed: CheckCircle2, rejected: CircleSlash, failed: XCircle } as const;
const STEP_COLOR = { proposed: "text-info", approved: "text-accent", completed: "text-ok", rejected: "text-ink-3", failed: "text-danger" } as const;
const STEP_LABEL = { proposed: "Proposed", approved: "Approved", completed: "Completed", rejected: "Declined", failed: "Failed" } as const;

function Timeline({ action }: { action: DemoAction }) {
  return (
    <ol aria-label="Status history" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label font-normal text-ink-2">
      {action.timeline.map((t, i) => {
        const Icon = STEP_ICON[t.status];
        return (
          <li key={`${t.status}-${i}`} className="inline-flex items-center gap-1.5">
            {i > 0 && <span className="text-ink-3" aria-hidden>→</span>}
            <Icon className={cn("h-3.5 w-3.5", STEP_COLOR[t.status])} aria-hidden />
            <span className="text-ink">{STEP_LABEL[t.status]}</span>
            <span className="tabular">{time(t.at)}</span>
          </li>
        );
      })}
    </ol>
  );
}
