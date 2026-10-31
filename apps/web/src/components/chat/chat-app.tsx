"use client";

import { isTerminal } from "@personalos/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Menu, RotateCcw, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, ApiRequestError } from "@/lib/api";
import { useTaskStream } from "@/lib/task-stream";
import { cn, greeting } from "@/lib/utils";
import { Composer } from "./composer";
import { Avatar, LiveAssistant } from "./live-assistant";
import { Markdown } from "./markdown";
import { Sidebar } from "./sidebar";

type Ref = { id: string; conversationId: string };

/** Suggestions that work with today's read-only capabilities; they prefill, never auto-send. */
const QUICK_ACTIONS = [
  { label: "Summarize a web page", prompt: "Summarize this page for me: " },
  { label: "Explain something simply", prompt: "Explain this simply, as if I'm new to it: " },
  { label: "Draft a message", prompt: "Help me draft a short, polite message to " },
  { label: "Brainstorm ideas", prompt: "Give me five fresh ideas for " },
];

const OFFLINE_COPY: Record<string, string> = {
  connecting: "Connecting to your assistant…",
  reconnecting: "Your assistant is reconnecting…",
  pairing_required: "The assistant runtime needs to be paired with this app.",
  down: "Your assistant is offline right now.",
};

export function ChatApp() {
  const router = useRouter();
  const conversationId = useSearchParams().get("c");
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.messages(conversationId!),
    enabled: !!conversationId,
  });

  const [draft, setDraft] = useState("");
  const [task, setTask] = useState<Ref | null>(null);
  const [pending, setPending] = useState<{ conversationId: string; text: string } | null>(null);
  const [failure, setFailure] = useState<{ message: string; retryText: string | null } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const lastSent = useRef("");
  const scroller = useRef<HTMLDivElement>(null);

  // Resume: after a reload (or from another tab), attach to a task still running server-side.
  // Derived during render rather than copied into state by an effect.
  const serverActive = conversations.data?.items.find((c) => c.id === conversationId)?.activeTaskId ?? null;
  const current: Ref | null = task ?? (conversationId && serverActive ? { id: serverActive, conversationId } : null);

  const view = useTaskStream(current?.id ?? null);
  const taskHere = current?.conversationId === conversationId ? current : null;

  // On a terminal status: refetch the transcript first, then swap the live bubble for it (no flicker).
  const terminal = view.status !== "CONNECTING" && isTerminal(view.status);
  const currentId = current?.id ?? null;
  const currentConversation = current?.conversationId ?? null;
  useEffect(() => {
    if (!terminal || !currentId) return;
    let stale = false;
    void (async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messages", currentConversation] }),
        qc.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
      if (stale) return;
      if (view.status === "FAILED" || view.status === "TIMED_OUT") {
        setFailure({
          message: view.error?.message ?? "The assistant ran into a problem.",
          retryText: view.error?.retryable === false ? null : lastSent.current || null,
        });
      }
      setTask(null);
      setPending(null);
    })();
    return () => {
      stale = true;
    };
  }, [terminal, currentId, currentConversation, qc, view.status, view.error]);

  // Keep the newest content in view unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight });
  }, [messages.data, view.text, view.steps.length, pending]);

  const gateway = health.data?.gateway;
  const offlineReason = gateway && gateway !== "connected" ? (OFFLINE_COPY[gateway] ?? "Unavailable") : null;

  function select(id: string | null) {
    setFailure(null);
    setNavOpen(false);
    router.push(id ? `/?c=${id}` : "/", { scroll: false });
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setFailure(null);
    let id = conversationId;
    try {
      if (!id) {
        id = (await api.createConversation()).id;
        router.replace(`/?c=${id}`, { scroll: false });
      }
      lastSent.current = trimmed;
      setPending({ conversationId: id, text: trimmed });
      setDraft("");
      const res = await api.send(id, { clientRequestId: crypto.randomUUID(), text: trimmed });
      setTask({ id: res.taskId, conversationId: id });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      setPending(null);
      setDraft(trimmed); // keep what the user wrote
      if (err instanceof ApiRequestError && err.code === "TASK_IN_PROGRESS" && id) {
        const active = (err.details as { taskId?: string } | undefined)?.taskId;
        if (active) setTask({ id: active, conversationId: id });
      }
      setFailure({ message: err instanceof ApiRequestError ? err.message : "Could not send. Check your connection.", retryText: null });
    }
  }

  async function stop() {
    if (!taskHere) return;
    try {
      await api.cancel(taskHere.id);
    } catch (err) {
      setFailure({ message: err instanceof ApiRequestError ? err.message : "Could not stop the task.", retryText: null });
    }
  }

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    router.replace("/login");
  }

  const history = conversationId ? (messages.data?.items ?? []) : [];
  const showPending = pending && pending.conversationId === conversationId;
  const empty = history.length === 0 && !showPending && !taskHere && !messages.isLoading;
  const firstName = me.data?.displayName.split(" ")[0];

  return (
    <div className="grid h-dvh md:grid-cols-[272px_1fr]">
      {/* Sidebar: static on desktop, sheet on mobile */}
      <aside className="hidden border-r border-line bg-surface/50 md:block">
        <Sidebar me={me.data} conversations={conversations.data?.items ?? []} activeId={conversationId} gateway={gateway} onSelect={select} onNew={() => select(null)} onLogout={logout} />
      </aside>
      <AnimatePresence>
        {navOpen && (
          <motion.div className="fixed inset-0 z-40 md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ink/30" onClick={() => setNavOpen(false)} aria-hidden />
            <motion.aside className="absolute inset-y-0 left-0 w-[85%] max-w-[300px] bg-bg shadow-xl" initial={{ x: -24 }} animate={{ x: 0 }} exit={{ x: -24 }}>
              <Button variant="ghost" size="icon" className="absolute top-4 right-3" onClick={() => setNavOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
              <Sidebar me={me.data} conversations={conversations.data?.items ?? []} activeId={conversationId} gateway={gateway} onSelect={select} onNew={() => select(null)} onLogout={logout} />
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex min-h-0 flex-col">
        <header className="flex items-center gap-2 px-4 pt-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-display text-lg">PersonalOS</span>
        </header>

        {offlineReason && (
          <div role="status" className="mx-auto mt-3 flex w-full max-w-3xl items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm text-ink-2">
            <span className="h-2 w-2 animate-pulse rounded-full bg-warn" aria-hidden /> {offlineReason}
          </div>
        )}

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            {empty ? (
              <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-[12vh]">
                <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
                  {greeting()}
                  {firstName ? `, ${firstName}` : ""}.
                </h1>
                <p className="mt-3 text-lg text-ink-2">What can I help you with?</p>
                <div className="mt-8 flex flex-wrap gap-2">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => {
                        setDraft(a.prompt);
                        document.getElementById("composer")?.focus();
                      }}
                      className="rounded-full border border-line bg-surface px-4 py-2 text-sm text-ink-2 transition-colors hover:border-accent/50 hover:text-ink"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </motion.section>
            ) : (
              <ol className="space-y-6" aria-label="Conversation">
                {history.map((m) => (
                  <li key={m.id}>{m.role === "user" ? <UserBubble text={m.text} /> : <AssistantMessage text={m.text} />}</li>
                ))}
                {showPending && (
                  <li>
                    <UserBubble text={pending.text} />
                  </li>
                )}
                {taskHere && (
                  <li>
                    <LiveAssistant view={view} />
                  </li>
                )}
              </ol>
            )}

            {failure && (
              <div role="alert" className="mt-6 flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                <p className="flex-1 text-ink-2">{failure.message}</p>
                {failure.retryText && (
                  <Button variant="outline" size="sm" onClick={() => void send(failure.retryText!)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={cn("mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6 sm:pb-6")}>
          <Composer value={draft} onChange={setDraft} onSend={() => void send(draft)} onStop={() => void stop()} busy={!!taskHere} disabledReason={offlineReason} />
        </div>
      </main>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
      <p className="max-w-[85%] rounded-3xl rounded-br-lg bg-surface-2 px-4 py-2.5 whitespace-pre-wrap">{text}</p>
    </motion.div>
  );
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-1">
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}
