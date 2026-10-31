"use client";

import { MAX_MESSAGE_CHARS } from "@personalos/contracts";
import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";

const MAX_HEIGHT = 220;

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabledReason: string | null;
};

export function Composer({ value, onChange, onSend, onStop, busy, disabledReason }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"; // no scrollbar until needed
  }, [value]);

  useEffect(() => {
    if (!busy) ref.current?.focus();
  }, [busy]);

  const canSend = !busy && !disabledReason && value.trim().length > 0;

  return (
    <div className="rounded-3xl border border-line bg-surface p-2 shadow-[0_10px_40px_-20px_rgba(60,40,20,0.35)] transition-colors focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/15">
      <label htmlFor="composer" className="sr-only">
        Message your assistant
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={value}
        maxLength={MAX_MESSAGE_CHARS}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (canSend) onSend();
          }
          if (e.key === "Escape" && busy) onStop();
        }}
        placeholder={disabledReason ?? "Ask anything…"}
        // The container shows focus (focus-within), so the field itself has no second ring.
        className="block max-h-[220px] w-full resize-none overflow-hidden bg-transparent px-3 pt-2 pb-1 text-[15px] leading-relaxed outline-none placeholder:text-ink-3 focus-visible:outline-none"
      />
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-xs text-ink-3">{busy ? "Esc to stop" : "Enter to send · Shift+Enter for a new line"}</span>
        {busy ? (
          <Button variant="outline" size="sm" onClick={onStop} aria-label="Stop generating">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Stop
          </Button>
        ) : (
          <Button size="icon" className="rounded-full" onClick={onSend} disabled={!canSend} aria-label="Send message">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
