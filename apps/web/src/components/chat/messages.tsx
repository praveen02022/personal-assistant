"use client";

import { CheckCircle2, CircleAlert, ExternalLink, FileText, LoaderCircle, Square, Volume2, Wrench, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/ui/logo";
import type { Step } from "@/lib/task-stream";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/** Readable column: ~70 characters per line for answers. */
export const MESSAGE_COLUMN = "mx-auto w-full max-w-[46rem] px-4 sm:px-6";

export function AssistantAvatar({ working = false }: { working?: boolean }) {
  return (
    <div className="relative mt-0.5 h-8 w-8 shrink-0" aria-hidden>
      <LogoMark className="h-8 w-8" />
      {working && (
        <motion.div className="absolute -inset-1 rounded-[10px] border-2 border-accent/50" animate={{ opacity: [0.25, 0.9, 0.25] }} transition={{ duration: 1.6, repeat: Infinity }} />
      )}
    </div>
  );
}

export function UserBubble({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="flex justify-end">
      <p className="max-w-[85%] rounded-xl rounded-br-sm bg-accent-soft px-4 py-2.5 whitespace-pre-wrap text-ink">{text}</p>
    </motion.div>
  );
}

export type SourceItem = { label: string; detail?: string; href?: string; kind: "tool" | "link" | "sample"; ok?: boolean };

/** The evidence behind an answer: tools that ran, links it cites, or sample records (demo). */
export function SourceList({ items, emptyNote }: { items: SourceItem[]; emptyNote?: string }) {
  if (items.length === 0 && !emptyNote) return null;
  return (
    <div className="mt-3">
      <p className="text-label text-ink-3">Sources</p>
      {items.length === 0 ? (
        <p className="mt-1 text-caption text-ink-3">{emptyNote}</p>
      ) : (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Sources">
          {items.map((s, i) => {
            const Icon = s.kind === "link" ? ExternalLink : s.kind === "sample" ? FileText : s.ok === false ? XCircle : Wrench;
            const body = (
              <>
                <Icon className={cn("h-3.5 w-3.5 shrink-0", s.ok === false ? "text-danger" : s.kind === "sample" ? "text-demo" : "text-ink-3")} aria-hidden />
                <span className="font-medium text-ink">{s.label}</span>
                {s.detail && <span className="text-ink-2">· {s.detail}</span>}
                {s.ok === false && <span className="text-danger">· failed</span>}
              </>
            );
            const cls = "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-label font-normal";
            return (
              <li key={`${s.label}-${i}`} className="max-w-full">
                {s.href ? (
                  <a href={s.href} target="_blank" rel="noopener noreferrer nofollow" className={cn(cls, "hover:border-line-strong hover:bg-surface-2")}>
                    {body}
                  </a>
                ) : (
                  <span className={cls}>{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function toolSources(steps: Step[]): SourceItem[] {
  return steps.filter((s) => s.key.startsWith("tool:")).map((s) => ({ label: s.label, kind: "tool", ok: s.state !== "failed" }));
}

export type SpeechState = "idle" | "loading" | "speaking";

export function AssistantMessage({
  text,
  canSpeak,
  speech,
  onSpeak,
  onStopSpeaking,
  footer,
}: {
  text: string;
  canSpeak: boolean;
  speech: SpeechState;
  onSpeak: () => void;
  onStopSpeaking: () => void;
  /** Sources, approval cards, etc. */
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <Markdown>{text}</Markdown>
        {footer}
        {canSpeak && (
          <div className="mt-2 -ml-2">
            {speech === "idle" ? (
              <Button variant="ghost" size="sm" onClick={onSpeak} aria-label="Read this answer aloud">
                <Volume2 className="h-4 w-4" aria-hidden /> Read aloud
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onStopSpeaking} aria-label="Stop reading" className="text-accent">
                <Square className="h-3 w-3 fill-current" aria-hidden /> {speech === "loading" ? "Preparing…" : "Stop"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Live progress steps from runtime events (never synthesised on the client). */
export function StepList({ steps }: { steps: Step[] }) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Progress" className="mb-3 space-y-1 rounded-lg border border-line bg-surface px-3 py-2 shadow-e1">
      <AnimatePresence initial={false}>
        {steps.map((s) => (
          <motion.li
            key={s.key}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className={cn("flex min-h-7 items-center gap-2 text-caption", s.state === "active" ? "text-ink" : "text-ink-2")}
          >
            {s.state === "active" && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />}
            {s.state === "done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" aria-hidden />}
            {s.state === "failed" && <XCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden />}
            <span className="truncate">{s.label}</span>
            <span className="sr-only">{s.state === "active" ? "(in progress)" : s.state === "done" ? "(done)" : "(failed)"}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

/** Playback status above the composer, with a labelled Stop. */
export function SpeechBar({ status, fallback, onStop }: { status: SpeechState; fallback: boolean; onStop: () => void }) {
  return (
    <AnimatePresence>
      {status !== "idle" && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.16 }}
          role="status"
          className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pr-1 pl-3 text-caption text-ink-2 shadow-e2"
        >
          {status === "loading" ? <LoaderCircle className="h-4 w-4 animate-spin text-accent" aria-hidden /> : <Volume2 className="h-4 w-4 animate-pulse text-accent" aria-hidden />}
          <span className="flex-1">{status === "loading" ? "Preparing voice…" : fallback ? "Speaking (browser voice)…" : "Speaking…"}</span>
          <Button variant="ghost" size="sm" onClick={onStop} aria-label="Stop speaking">
            <Square className="h-3 w-3 fill-current" aria-hidden /> Stop
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function InlineError({ message, onDismiss, action }: { message: string; onDismiss?: () => void; action?: React.ReactNode }) {
  return (
    <div role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-line bg-surface py-1 pr-1 pl-3 text-caption text-ink-2 shadow-e2">
      <CircleAlert className="h-4 w-4 shrink-0 text-danger" aria-hidden />
      <span className="flex-1 py-1.5">{message}</span>
      {action}
      {onDismiss && (
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Dismiss">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  );
}
