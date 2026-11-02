"use client";

import { isTerminal } from "@personalos/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical } from "lucide-react";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Composer, type ComposerHandle } from "@/components/chat/composer";
import { LiveAssistant } from "@/components/chat/live-assistant";
import { AssistantMessage, InlineError, MESSAGE_COLUMN, SourceList, SpeechBar, UserBubble } from "@/components/chat/messages";
import { ErrorState, SampleBadge, Skeleton } from "@/components/ui/primitives";
import { api, ApiRequestError } from "@/lib/api";
import { useTaskStream } from "@/lib/task-stream";
import { cn } from "@/lib/utils";
import { useSpeechPlayer } from "@/lib/voice/player";
import { type VoiceDraftInfo, useVoiceInput } from "@/lib/voice/use-voice-input";
import { ApprovalCard } from "./approval-card";
import { DEMO_PROMPTS } from "./briefing";

/**
 * The demo assistant: the same composer, voice input, progress, streaming, Stop and read-aloud as
 * the connected assistant, but answers come from the API's scripted demo (sample data only).
 */
export function DemoAssistant() {
  const router = useRouter();
  const ask = useSearchParams().get("ask");
  const qc = useQueryClient();
  const ws = useQuery({ queryKey: ["demo-workspace"], queryFn: api.demo.workspace });
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });

  const [draft, setDraft] = useState("");
  const [turnId, setTurnId] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState<VoiceDraftInfo | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const voiceTurn = useRef<string | null>(null);
  const askedFor = useRef<string | null>(null);

  const voiceAvailable = health.data?.voice === "ok";
  const voiceSettings = useQuery({ queryKey: ["voice-settings"], queryFn: api.voiceSettings, enabled: voiceAvailable });
  const autoSpeak = voiceSettings.data?.preferences.autoSpeak ?? true;
  const player = useSpeechPlayer();
  const speak = player.speak;
  const voice = useVoiceInput({
    onTranscript: (text, info) => {
      setDraft((d) => (d.trim() ? `${d.trimEnd()} ${text}` : text));
      setVoiceDraft(info);
      composer.current?.focus();
    },
  });

  const current = turnId ?? ws.data?.activeTurnId ?? null;
  const view = useTaskStream(current, "demo");
  const terminal = view.status !== "CONNECTING" && isTerminal(view.status);

  useEffect(() => {
    if (!terminal || !current) return;
    let stale = false;
    void (async () => {
      await qc.invalidateQueries({ queryKey: ["demo-workspace"] });
      if (stale) return;
      if (view.status === "SUCCEEDED" && view.final && voiceTurn.current === current && autoSpeak) void speak(view.final, `turn:${current}`);
      if (voiceTurn.current === current) voiceTurn.current = null;
      setTurnId(null);
    })();
    return () => {
      stale = true;
    };
  }, [terminal, current, qc, view.status, view.final, autoSpeak, speak]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTo({ top: el.scrollHeight });
  }, [ws.data?.messages.length, view.text, view.steps.length, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || current) return;
    setFailure(null);
    player.stop();
    const fromVoice = voiceDraft !== null;
    setPending(trimmed);
    setDraft("");
    setVoiceDraft(null);
    try {
      const res = await api.demo.startTurn({ clientRequestId: crypto.randomUUID(), text: trimmed });
      if (fromVoice) voiceTurn.current = res.turnId;
      setTurnId(res.turnId);
      await qc.invalidateQueries({ queryKey: ["demo-workspace"] });
    } catch (err) {
      setDraft(trimmed);
      setFailure(err instanceof ApiRequestError ? err.message : "Couldn't reach the demo. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  // A question handed over from the briefing page (?ask=) is asked once, then removed from the URL.
  useEffect(() => {
    if (!ask || askedFor.current === ask || !ws.data || ws.data.activeTurnId) return;
    askedFor.current = ask;
    router.replace("/demo/assistant", { scroll: false });
    void sendRef.current(ask);
  }, [ask, ws.data, router]);

  const messages = ws.data?.messages ?? [];
  const actions = new Map((ws.data?.actions ?? []).map((a) => [a.id, a]));
  const empty = messages.length === 0 && !pending && !current;

  return (
    <section aria-label="Demo assistant" className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface/70 px-4 backdrop-blur sm:px-6">
        <h1 className="min-w-0 flex-1 truncate text-heading">Assistant</h1>
        <SampleBadge>Answers from sample data</SampleBadge>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn(MESSAGE_COLUMN, "py-8")}>
          {ws.isError && <ErrorState title="Couldn't load the demo" message="The demo service didn't respond." onRetry={() => void ws.refetch()} />}
          {ws.isLoading ? (
            <div role="status" aria-label="Loading demo conversation" className="space-y-6">
              <Skeleton className="h-24 w-full" />
            </div>
          ) : empty ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="pt-[6vh]">
              <h2 className="text-display">What would you like to check?</h2>
              <p className="mt-2 text-ink-2">
                This assistant works for <span className="font-medium text-ink">{ws.data?.business.name}</span>, a fictional real-estate office. Ask by typing, or hold the mic and speak; your words are transcribed by the real speech service and shown to you before sending.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {DEMO_PROMPTS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void send(p)}
                    className="min-h-11 rounded-lg border border-line bg-surface px-4 py-3 text-left text-caption text-ink shadow-e1 transition-colors hover:border-line-strong hover:bg-surface-2"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <ol className="space-y-8" aria-label="Conversation">
              {messages.map((m) => (
                <li key={m.id}>
                  {m.role === "user" ? (
                    <UserBubble text={m.text} />
                  ) : (
                    <AssistantMessage
                      text={m.text}
                      canSpeak={voiceAvailable}
                      speech={player.key === m.id || player.key === `turn:${m.id.replace(/:a$/, "")}` ? player.status : "idle"}
                      onSpeak={() => void player.speak(m.text, m.id)}
                      onStopSpeaking={player.stop}
                      footer={
                        <>
                          <SourceList items={m.sources.map((s) => ({ label: s.label, detail: s.detail, kind: "sample" }))} emptyNote="No sample records used." />
                          {m.actionIds.length > 0 && (
                            <div className="mt-4 space-y-3">
                              {m.actionIds.map((id) => {
                                const a = actions.get(id);
                                return a ? <ApprovalCard key={id} action={a} compact /> : null;
                              })}
                            </div>
                          )}
                        </>
                      }
                    />
                  )}
                </li>
              ))}
              {pending && (
                <li>
                  <UserBubble text={pending} />
                </li>
              )}
              {current && (
                <li>
                  <LiveAssistant view={view} />
                </li>
              )}
            </ol>
          )}
          {failure && (
            <div className="mt-6">
              <InlineError message={failure} onDismiss={() => setFailure(null)} />
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
          placeholder="Ask about today, follow-ups, lunch or payments…"
          onChange={(v) => {
            setDraft(v);
            if (!v.trim()) setVoiceDraft(null);
          }}
          onSend={() => void send(draft)}
          onStop={() => current && void api.demo.cancelTurn(current).catch(() => undefined)}
          busy={!!current}
          disabledReason={null}
          voice={{
            state: voice.recorderState,
            transcribing: voice.transcribing,
            level: voice.level,
            elapsedMs: voice.elapsedMs,
            disabledReason: !health.data ? "Checking voice…" : !voiceAvailable ? "Voice isn't set up on the server" : null,
            draftInfo: voiceDraft,
            onStart: () => {
              player.stop();
              voice.start();
            },
            onStop: voice.stop,
            onCancel: voice.cancel,
          }}
        />
        <p className="mt-2 flex items-center justify-center gap-1.5 text-label font-normal text-ink-3">
          <FlaskConical className="h-3.5 w-3.5 text-demo" aria-hidden /> Demo assistant: scripted answers from sample data. Nothing real is sent or ordered.
        </p>
      </div>
    </section>
  );
}
