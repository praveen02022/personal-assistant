"use client";

import { isTerminal, TaskEvent, type TaskEventType, type TaskStatus } from "@personalos/contracts";
import { useEffect, useReducer } from "react";

export type Step = { key: string; label: string; state: "active" | "done" | "failed" };

export type TaskView = {
  status: TaskStatus | "CONNECTING";
  steps: Step[];
  text: string;
  final: string | null;
  error: { code: string; message: string; retryable: boolean } | null;
};

export const initialTaskView: TaskView = { status: "CONNECTING", steps: [], text: "", final: null, error: null };

const PHASE_LABEL: Record<string, string> = {
  preparing: "Getting ready",
  thinking: "Thinking",
  resumed: "Reconnected, resuming",
  finishing: "Wrapping up",
};

/** Steps come only from runtime events; nothing is synthesised or timed. */
function settleActive(steps: Step[]): Step[] {
  return steps.map((s) => (s.state === "active" ? { ...s, state: "done" } : s));
}

export function reduceTask(view: TaskView, event: TaskEvent): TaskView {
  switch (event.type) {
    case "task.status": {
      const done = isTerminal(event.status);
      return {
        ...view,
        status: event.status,
        steps: done ? view.steps.map((s) => (s.state === "active" ? { ...s, state: event.status === "SUCCEEDED" ? "done" : "failed" } : s)) : view.steps,
      };
    }
    case "task.progress":
      return { ...view, steps: [...settleActive(view.steps), { key: `phase:${event.phase}:${view.steps.length}`, label: PHASE_LABEL[event.phase] ?? event.phase, state: "active" }] };
    case "tool.started":
      return { ...view, steps: [...settleActive(view.steps), { key: `tool:${event.toolCallId}`, label: event.label, state: "active" }] };
    case "tool.finished":
      return {
        ...view,
        steps: view.steps.map((s) => (s.key === `tool:${event.toolCallId}` ? { ...s, state: event.ok ? "done" : "failed" } : s)),
      };
    case "assistant.text":
      return { ...view, text: event.text, steps: settleActive(view.steps) };
    case "assistant.final":
      return { ...view, text: event.text, final: event.text };
    case "task.error":
      return { ...view, error: { code: event.code, message: event.message, retryable: event.retryable } };
  }
}

const EVENT_TYPES: TaskEventType[] = ["task.status", "task.progress", "tool.started", "tool.finished", "assistant.text", "assistant.final", "task.error"];

/** Where a task's SSE stream lives: real tasks, or scripted demo turns (same event shapes). */
export type StreamSource = "tasks" | "demo";
const streamUrl = (source: StreamSource, id: string) => (source === "demo" ? `/api/demo/turns/${id}/events` : `/api/tasks/${id}/events`);

/** Subscribes to a task's events. Closes itself on a terminal status. */
export function useTaskStream(taskId: string | null, source: StreamSource = "tasks"): TaskView {
  const [view, dispatch] = useReducer(
    (state: TaskView, action: TaskEvent | { type: "reset" }) => (action.type === "reset" ? initialTaskView : reduceTask(state, action)),
    initialTaskView,
  );

  useEffect(() => {
    dispatch({ type: "reset" });
    if (!taskId) return;
    const es = new EventSource(streamUrl(source, taskId));
    const onMessage = (msg: MessageEvent<string>) => {
      const parsed = TaskEvent.safeParse(JSON.parse(msg.data));
      if (!parsed.success) return; // unknown/newer event shape: ignore rather than crash
      dispatch(parsed.data);
      if (parsed.data.type === "task.status" && isTerminal(parsed.data.status)) es.close();
    };
    for (const t of EVENT_TYPES) es.addEventListener(t, onMessage);
    return () => es.close();
  }, [taskId, source]);

  return view;
}
