"use client";

import { type ChatMessage, type ConversationSummary, isTerminal } from "@personalos/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, MessageSquarePlus, Plus, RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Notice, Skeleton, StatusDot } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { type Step, useTaskStream } from "@/lib/task-stream";
import { cn, greeting } from "@/lib/utils";
import { useSpeechPlayer } from "@/lib/voice/player";
import { type VoiceDraftInfo, useVoiceInput } from "@/lib/voice/use-voice-input";
import { Composer, type ComposerHandle } from "./composer";
import { LiveAssistant } from "./live-assistant";
import { extractLinks } from "./markdown";
import { AssistantMessage, InlineError, MESSAGE_COLUMN, type SourceItem, SourceList, SpeechBar, toolSources, UserBubble } from "./messages";

type Ref = { id: string; conversationId: string };

/** Suggestions that work with today's read-only capabilities; they prefill, never auto-send. */
const QUICK_ACTIONS = [
  { label: "What meetings do I have tomorrow?", prompt: "What meetings do I have tomorrow?" },
  { label: "Summarize a web page", prompt: "Summarize this page for me: " },
  { label: "Draft a message", prompt: "Help me draft a short, polite message to " },
  { label: "Explain something simply", prompt: "Explain this simply, as if I'm new to it: " },
];

const OFFLINE_COPY: Record<string, string> = {
  connecting: "Connecting to your assistant…",
  reconnecting: "Your assistant is reconnecting…",
  pairing_required: "The assistant runtime needs to be paired with this app.",
  down: "Your assistant is offline right now.",
};

export function ChatApp() {
  const router = useRouter();
  const params = useSearchParams();
  const conversationId = params.get("c");
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const conversations = useQuery({ queryKey: ["conversations"], queryFn: api.conversations });
  const messages = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.messages(conversationId!),
    enabled: !!conversationId,
  });

  // A prompt handed over from Home (?prompt=) prefills the draft; it is never sent automatically.
  const [draft, setDraft] = useState(() => params.get("prompt") ?? "");
  const [task, setTask] = useState<Ref | null>(null);
  const [pending, setPending] = useState<{ conversationId: string; text: string } | null>(null);
  const [failure, setFailure] = useState<{ message: string; retryText: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraftInfo | null>(null);
  /** Tool steps behind answers produced in this session (the transcript itself doesn't carry them). */
  const [stepsByMessage, setStepsByMessage] = useState<Record<string, Step[]>>({});
  const lastSent = useRef("");
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  /**
   * The last submission the server has not acknowledged. If the network drops before any
   * response arrives, resending the same text reuses its clientRequestId, so the server returns
   * the task it may already have created instead of running the message twice.
   */
  const unacked = useRef<{ conversationId: string; text: string; clientRequestId: string } | null>(null);
  /** Task started from a voice transcript: its answer is spoken when it completes. */
  const voiceTask = useRef<string | null>(null);

  const voiceAvailable = health.data?.voice === "ok";
  const voiceSettings = useQuery({ queryKey: ["voice-settings"], queryFn: api.voiceSettings, enabled: voiceAvailable });
  const autoSpeak = voiceSettings.data?.preferences.autoSpeak ?? true;
  const player = useSpeechPlayer();
  const speak = player.speak; // stable callback; `player` itself is a new object every render
  const voice = useVoiceInput({
    onTranscript: (text, info) => {
      // The transcript joins the draft for review; it is never sent automatically.
      setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
      setVoiceDraft(info);
      composer.current?.focus();
    },
  });

  // Drop ?prompt= from the URL once it has been used, so a reload doesn't prefill again.
  useEffect(() => {
    if (params.get("prompt")) router.replace(conversationId ? `/assistant?c=${conversationId}` : "/assistant", { scroll: false });
  }, [params, router, conversationId]);

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
    const steps = view.steps;
    void (async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["messages", currentConversation] }),
        qc.invalidateQueries({ queryKey: ["conversations"] }),
      ]);
      if (stale) return;
      if (view.status === "SUCCEEDED") {
        // Keep the steps as this answer's sources (the newest assistant message is this task's answer).
        const latest = qc.getQueryData<{ items: ChatMessage[] }>(["messages", currentConversation])?.items.findLast((m) => m.role === "assistant");
        if (latest) setStepsByMessage((prev) => ({ ...prev, [latest.id]: steps }));
      }
      if (view.status === "SUCCEEDED" && view.final && voiceTask.current === currentId && autoSpeak) {
        void speak(view.final, `task:${currentId}`);
      }
      if (voiceTask.current === currentId) voiceTask.current = null;
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
  }, [terminal, currentId, currentConversation, qc, view.status, view.error, view.final, view.steps, autoSpeak, speak]);

  // Keep the newest content in view unless the user has scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTo({ top: el.scrollHeight });
  }, [messages.data, view.text, view.steps.length, pending]);

  const gateway = health.data?.gateway;
  const offlineReason = gateway && gateway !== "connected" ? (OFFLINE_COPY[gateway] ?? "Unavailable") : null;
  const voiceDisabledReason = !health.data ? "Checking voice…" : !voiceAvailable ? "Voice isn't set up on the server" : null;

  function startVoice() {
    player.stop(); // talking over the assistant interrupts it
    voice.start();
  }

  function select(id: string | null) {
    setFailure(null);
    setHistoryOpen(false);
    router.push(id ? `/assistant?c=${id}` : "/assistant", { scroll: false });
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setFailure(null);
    player.stop();
    const fromVoice = voiceDraft !== null;
    let id = conversationId;
    try {
      if (!id) {
        id = (await api.createConversation()).id;
        router.replace(`/assistant?c=${id}`, { scroll: false });
      }
      lastSent.current = trimmed;
      setPending({ conversationId: id, text: trimmed });
      setDraft("");
      setVoiceDraft(null);
      const prior = unacked.current;
      const clientRequestId = prior && prior.conversationId === id && prior.text === trimmed ? prior.clientRequestId : crypto.randomUUID();
      unacked.current = { conversationId: id, text: trimmed, clientRequestId };
      const res = await api.send(id, { clientRequestId, text: trimmed });
      unacked.current = null; // acknowledged
      if (fromVoice) voiceTask.current = res.taskId;
      setTask({ id: res.taskId, conversationId: id });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (err) {
      // Any HTTP response is definitive; only a missing response (network) keeps the id for a safe resend.
      if (err instanceof ApiRequestError) unacked.current = null;
      setPending(null);
      setDraft(trimmed); // keep what the user wrote
      if (err instanceof ApiRequestError && err.code === "TASK_IN_PROGRESS" && id) {
        const active = (err.details as { taskId?: string } | undefined)?.taskId;
        if (active) setTask({ id: active, conversationId: id });
      }
      setFailure({
        message: err instanceof ApiRequestError ? err.message : "Couldn't confirm your message was received. Press Send again; it won't be sent twice.",
        retryText: null,
      });
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

  const history = conversationId ? (messages.data?.items ?? []) : [];
  const showPending = pending && pending.conversationId === conversationId;
  const loadingHistory = !!conversationId && messages.isLoading;
  const empty = history.length === 0 && !showPending && !taskHere && !loadingHistory;
  const firstName = me.data?.displayName.split(" ")[0];
  const title = conversations.data?.items.find((c) => c.id === conversationId)?.title ?? (conversationId ? "Conversation" : "New conversation");

  const list = <ConversationList items={conversations.data?.items ?? []} loading={conversations.isLoading} activeId={conversationId} onSelect={select} onNew={() => select(null)} />;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Conversation history: a column on wide screens, a sheet otherwise */}
      <aside aria-label="Conversation history" className="hidden w-[264px] shrink-0 flex-col border-r border-line bg-bg xl:flex">
        {list}
      </aside>
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} title="Conversations" variant="sheet-left">
        {list}
      </Dialog>

      <section aria-label="Assistant" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setHistoryOpen(true)} aria-label="Show conversation history">
            <History className="h-4 w-4" aria-hidden />
          </Button>
          <h1 className="min-w-0 flex-1 truncate text-heading">{title}</h1>
          <Button variant="secondary" size="sm" onClick={() => select(null)}>
            <MessageSquarePlus className="h-4 w-4" aria-hidden /> New chat
          </Button>
        </div>

        {offlineReason && (
          <div className={cn(MESSAGE_COLUMN, "pt-3")}>
            <Notice tone="warn">
              <span className="flex items-center gap-2">
                <StatusDot tone="warn" pulse /> {offlineReason} Sending is paused until it&apos;s back.
              </span>
            </Notice>
          </div>
        )}

        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn(MESSAGE_COLUMN, "py-8")}>
            {loadingHistory ? (
              <div role="status" aria-label="Loading conversation" className="space-y-6">
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : empty ? (
              <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="pt-[8vh]">
                <h2 className="text-display">
                  {greeting()}
                  {firstName ? `, ${firstName}` : ""}.
                </h2>
                <p className="mt-2 text-ink-2">Type a question, or hold the mic and speak in English or Tamil. You&apos;ll see your words before anything is sent.</p>
                <div className="mt-6 grid gap-2 sm:grid-cols-2">
                  {QUICK_ACTIONS.map((a) => (
                    <button
                      key={a.label}
                      type="button"
                      onClick={() => {
                        setDraft(a.prompt);
                        composer.current?.focus();
                      }}
                      className="min-h-11 rounded-lg border border-line bg-surface px-4 py-3 text-left text-caption text-ink shadow-e1 transition-colors hover:border-line-strong hover:bg-surface-2"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </motion.section>
            ) : (
              <ol className="space-y-8" aria-label="Conversation">
                {history.map((m) => (
                  <li key={m.id}>
                    {m.role === "user" ? (
                      <UserBubble text={m.text} />
                    ) : (
                      <AssistantMessage
                        text={m.text}
                        canSpeak={voiceAvailable}
                        speech={player.key === m.id || player.key === `task:${m.id}` ? player.status : "idle"}
                        onSpeak={() => void player.speak(m.text, m.id)}
                        onStopSpeaking={player.stop}
                        footer={<AnswerSources text={m.text} steps={stepsByMessage[m.id]} />}
                      />
                    )}
                  </li>
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
              <div className="mt-6">
                <InlineError
                  message={failure.message}
                  action={
                    failure.retryText && (
                      <Button variant="secondary" size="sm" onClick={() => void send(failure.retryText!)}>
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
                      </Button>
                    )
                  }
                />
              </div>
            )}
          </div>
        </div>

        <div className={cn(MESSAGE_COLUMN, "pb-4 sm:pb-6")}>
          <SpeechBar status={player.status} fallback={player.fallback} onStop={player.stop} />
          {voice.error && <InlineError message={voice.error} onDismiss={voice.clearError} />}
          <Composer
            ref={composer}
            value={draft}
            onChange={(v) => {
              setDraft(v);
              if (!v.trim()) setVoiceDraft(null);
            }}
            onSend={() => void send(draft)}
            onStop={() => void stop()}
            busy={!!taskHere}
            disabledReason={offlineReason}
            voice={{
              state: voice.recorderState,
              transcribing: voice.transcribing,
              level: voice.level,
              elapsedMs: voice.elapsedMs,
              disabledReason: voiceDisabledReason,
              draftInfo: voiceDraft,
              onStart: startVoice,
              onStop: voice.stop,
              onCancel: voice.cancel,
            }}
          />
        </div>
      </section>
    </div>
  );
}

/** Tools used (this session) and web links cited: the evidence behind an answer. */
function AnswerSources({ text, steps }: { text: string; steps: Step[] | undefined }) {
  const items: SourceItem[] = [...toolSources(steps ?? []), ...extractLinks(text).map((l) => ({ label: l.host, href: l.href, kind: "link" as const }))];
  if (items.length === 0) return steps ? <SourceList items={[]} emptyNote="No tools or web sources used: answered from general knowledge." /> : null;
  return <SourceList items={items} />;
}

function ConversationList({
  items,
  loading,
  activeId,
  onSelect,
  onNew,
}: {
  items: ConversationSummary[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <nav aria-label="Conversations" className="flex min-h-0 flex-1 flex-col">
      <div className="p-3">
        <Button variant="secondary" className="w-full justify-start" onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden /> New conversation
        </Button>
      </div>
      <p className="px-5 pb-1 text-label text-ink-3">Recent</p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {loading &&
          Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="px-2 py-1">
              <Skeleton className="h-8 w-full" />
            </li>
          ))}
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-caption transition-colors md:min-h-9",
                c.id === activeId ? "bg-surface-3 font-medium text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <span className="truncate">{c.title ?? "New conversation"}</span>
              {c.activeTaskId && (
                <span className="ml-auto inline-flex items-center gap-1 text-label text-accent">
                  <StatusDot tone="accent" pulse /> <span className="sr-only">working</span>
                </span>
              )}
            </button>
          </li>
        ))}
        {!loading && items.length === 0 && <li className="px-3 py-2 text-caption text-ink-3">No conversations yet. Your chats will appear here.</li>}
      </ul>
    </nav>
  );
}
