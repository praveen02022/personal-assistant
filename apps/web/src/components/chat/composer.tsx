"use client";

import { MAX_MESSAGE_CHARS } from "@personalos/contracts";
import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RecorderState } from "@/lib/voice/recorder";
import type { VoiceDraftInfo } from "@/lib/voice/use-voice-input";
import { formatElapsed, MicButton } from "./mic-button";

const MAX_HEIGHT = 220;

export type ComposerVoice = {
  state: RecorderState;
  transcribing: boolean;
  level: number;
  elapsedMs: number;
  disabledReason: string | null;
  draftInfo: VoiceDraftInfo | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
  disabledReason: string | null;
  voice: ComposerVoice;
  placeholder?: string;
};

export type ComposerHandle = { focus: () => void };

export const Composer = forwardRef<ComposerHandle, Props>(function Composer({ value, onChange, onSend, onStop, busy, disabledReason, voice, placeholder }, handle) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(handle, () => ({
    focus: () => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    },
  }));

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

  const recording = voice.state === "recording";
  const canSend = !busy && !disabledReason && !recording && !voice.transcribing && value.trim().length > 0;

  const hint = recording
    ? `Listening ${formatElapsed(voice.elapsedMs)} · release or tap the mic to finish · Esc to cancel`
    : voice.state === "requesting"
      ? "Allow microphone access to talk…"
      : voice.transcribing
        ? "Transcribing…"
        : voice.draftInfo
          ? `From voice${voice.draftInfo.locale === "ta-IN" ? " (Tamil)" : ""} · ${voice.draftInfo.lowConfidence ? "please check it carefully" : "edit if needed"}, then send`
          : busy
            ? "Esc to stop"
            : "Enter to send · Shift+Enter for a new line";

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface p-2 shadow-e2 transition-[border-color,box-shadow] duration-150 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
        recording ? "border-accent ring-2 ring-accent/20" : "border-line-strong",
      )}
    >
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
          if (e.key === "Escape") {
            if (voice.state !== "idle" || voice.transcribing) voice.onCancel();
            else if (busy) onStop();
          }
        }}
        placeholder={disabledReason ?? (recording ? "Listening…" : (placeholder ?? "Ask anything, or hold the mic to talk…"))}
        // The container shows focus (focus-within), so the field itself has no second ring.
        className="block max-h-[220px] w-full resize-none overflow-hidden bg-transparent px-3 pt-2 pb-1 text-[16px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none md:text-body"
      />
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <MicButton
            state={voice.state}
            transcribing={voice.transcribing}
            level={voice.level}
            disabledReason={voice.disabledReason}
            onStart={voice.onStart}
            onStop={voice.onStop}
            onCancel={voice.onCancel}
          />
          <span aria-live="polite" className={cn("truncate text-label font-normal", recording ? "text-accent" : voice.draftInfo?.lowConfidence ? "text-warn" : "text-ink-3")}>
            {hint}
          </span>
        </div>
        {busy ? (
          <Button variant="secondary" size="sm" onClick={onStop} aria-label="Stop generating">
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> Stop
          </Button>
        ) : (
          <Button size="icon" className="shrink-0" onClick={onSend} disabled={!canSend} aria-label="Send message">
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
});
