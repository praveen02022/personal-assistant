"use client";

import { Check, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { TaskView } from "@/lib/task-stream";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

/** The in-flight assistant turn: real progress steps from runtime events, then streamed text. */
export function LiveAssistant({ view }: { view: TaskView }) {
  const working = view.status === "CONNECTING" || view.status === "QUEUED" || view.status === "RUNNING";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <Avatar working={working} />
      <div className="min-w-0 flex-1 pt-1">
        {view.steps.length > 0 && (
          <ol aria-label="Progress" className="mb-3 space-y-1.5">
            <AnimatePresence initial={false}>
              {view.steps.map((s) => (
                <motion.li
                  key={s.key}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn("flex items-center gap-2 text-sm", s.state === "active" ? "text-ink" : "text-ink-3")}
                >
                  {s.state === "active" && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />}
                  {s.state === "done" && <Check className="h-3.5 w-3.5 text-ok" aria-hidden />}
                  {s.state === "failed" && <X className="h-3.5 w-3.5 text-danger" aria-hidden />}
                  <span className="truncate">{s.label}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ol>
        )}
        <div aria-live="polite" aria-busy={working}>
          {view.text ? (
            <Markdown>{view.text}</Markdown>
          ) : (
            working && view.steps.length === 0 && <p className="text-sm text-ink-3">Connecting…</p>
          )}
        </div>
        {view.status === "CANCELLED" && <p className="mt-2 text-sm text-ink-3">Stopped.</p>}
      </div>
    </motion.div>
  );
}

export function Avatar({ working = false }: { working?: boolean }) {
  return (
    <div className="relative mt-0.5 h-8 w-8 shrink-0" aria-hidden>
      <div className="absolute inset-0 rounded-xl bg-accent" />
      {working && <motion.div className="absolute -inset-1 rounded-2xl border-2 border-accent/40" animate={{ opacity: [0.2, 0.8, 0.2] }} transition={{ duration: 1.6, repeat: Infinity }} />}
    </div>
  );
}
