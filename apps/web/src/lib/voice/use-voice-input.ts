"use client";

import { VOICE_LIMITS } from "@personalos/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiRequestError } from "@/lib/api";
import { useRecorder } from "./recorder";

export type VoiceDraftInfo = { locale: string | null; lowConfidence: boolean };

/**
 * Push-to-talk orchestration: record -> transcribe -> hand the text to the composer for review.
 * Nothing is ever sent automatically: the user edits and presses Send.
 */
export function useVoiceInput({ onTranscript }: { onTranscript: (text: string, info: VoiceDraftInfo) => void }) {
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const recorder = useRecorder({
    onError: setError,
    onRecorded: ({ blob }) => {
      if (blob.size > VOICE_LIMITS.maxAudioBytes) {
        setError("That recording is too long. Keep it under a minute.");
        return;
      }
      const abort = new AbortController();
      inflight.current = abort;
      setTranscribing(true);
      api
        .transcribe(blob, undefined, abort.signal)
        .then((t) => {
          if (abort.signal.aborted) return; // cancelled after the response arrived
          onTranscript(t.text, { locale: t.locale, lowConfidence: t.confidence !== null && t.confidence < VOICE_LIMITS.lowConfidence });
        })
        .catch((err: unknown) => {
          if (abort.signal.aborted) return;
          setError(err instanceof ApiRequestError ? err.message : "Couldn't transcribe that. Check your connection.");
        })
        .finally(() => {
          if (inflight.current === abort) inflight.current = null;
          setTranscribing(false);
        });
    },
  });

  const start = useCallback(() => {
    setError(null);
    void recorder.start();
  }, [recorder]);

  /** Cancels recording or an in-flight transcription. */
  const cancel = useCallback(() => {
    recorder.cancel();
    inflight.current?.abort();
    inflight.current = null;
    setTranscribing(false);
  }, [recorder]);

  // Leaving the page aborts an in-flight transcription (the server then cancels the provider call).
  useEffect(
    () => () => {
      inflight.current?.abort();
      inflight.current = null;
    },
    [],
  );

  return {
    recorderState: recorder.state,
    level: recorder.level,
    elapsedMs: recorder.elapsedMs,
    transcribing,
    error,
    clearError: () => setError(null),
    start,
    stop: recorder.stop,
    cancel,
  };
}
