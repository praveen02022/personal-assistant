"use client";

import type { ConversationSummary, GatewayState, Me } from "@personalos/contracts";
import { LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const GATEWAY_LABEL: Record<GatewayState, { label: string; tone: string }> = {
  connected: { label: "Assistant online", tone: "bg-ok" },
  connecting: { label: "Connecting…", tone: "bg-warn" },
  reconnecting: { label: "Reconnecting…", tone: "bg-warn" },
  pairing_required: { label: "Runtime needs pairing", tone: "bg-danger" },
  down: { label: "Assistant offline", tone: "bg-danger" },
};

type Props = {
  me: Me | undefined;
  conversations: ConversationSummary[];
  activeId: string | null;
  gateway: GatewayState | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
  onLogout: () => void;
};

export function Sidebar({ me, conversations, activeId, gateway, onSelect, onNew, onLogout }: Props) {
  const g = gateway ? GATEWAY_LABEL[gateway] : null;
  return (
    <nav aria-label="Conversations" className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
        <div className="h-7 w-7 rounded-lg bg-accent" aria-hidden />
        <span className="font-display text-lg tracking-tight">PersonalOS</span>
      </div>
      <div className="px-3">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden /> New conversation
        </Button>
      </div>
      <ul className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-2">
        {conversations.map((c) => (
          <li key={c.id}>
            <button
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                c.id === activeId ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2/60",
              )}
            >
              <span className="truncate">{c.title ?? "New conversation"}</span>
              {c.activeTaskId && <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-label="working" />}
            </button>
          </li>
        ))}
        {conversations.length === 0 && <li className="px-3 py-2 text-sm text-ink-3">No conversations yet.</li>}
      </ul>
      <div className="space-y-3 border-t border-line px-4 py-4">
        {g && (
          <p className="flex items-center gap-2 text-xs text-ink-2" role="status">
            <span className={cn("h-2 w-2 rounded-full", g.tone)} aria-hidden />
            {g.label}
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="truncate text-sm text-ink-2">{me?.displayName}</span>
          <Button variant="ghost" size="icon" onClick={onLogout} aria-label="Sign out">
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </nav>
  );
}
