"use client";

import { motion } from "motion/react";
import type { TaskView } from "@/lib/task-stream";
import { Markdown } from "./markdown";
import { AssistantAvatar, StepList } from "./messages";

/** The in-flight assistant turn: real progress steps from runtime events, then streamed text. */
export function LiveAssistant({ view }: { view: TaskView }) {
  const working = view.status === "CONNECTING" || view.status === "QUEUED" || view.status === "RUNNING";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="flex gap-3">
      <AssistantAvatar working={working} />
      <div className="min-w-0 flex-1 pt-0.5">
        <StepList steps={view.steps} />
        <div aria-live="polite" aria-busy={working}>
          {view.text ? <Markdown>{view.text}</Markdown> : working && view.steps.length === 0 && <p className="text-caption text-ink-3">Connecting…</p>}
        </div>
        {view.status === "CANCELLED" && <p className="mt-2 text-caption text-ink-3">Stopped. Nothing further was done.</p>}
      </div>
    </motion.div>
  );
}
