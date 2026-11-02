"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TAMIL = /[஀-௿]/;

export type PlayerState = { status: "idle" | "loading" | "speaking"; key: string | null; fallback: boolean };

/**
 * Speaks text via POST /api/voice/speech (Azure neural voices, chosen server-side).
 * Falls back to the browser's SpeechSynthesis if the service fails. Only one utterance
 * plays at a time; starting another (or the mic) interrupts the current one.
 */
export function useSpeechPlayer() {
  const [state, setState] = useState<PlayerState>({ status: "idle", key: null, fallback: false });
  const current = useRef<{ abort: AbortController; audio: HTMLAudioElement | null; url: string | null } | null>(null);

  const stop = useCallback(() => {
    const c = current.current;
    current.current = null;
    if (c) {
      c.abort.abort();
      c.audio?.pause();
      if (c.url) URL.revokeObjectURL(c.url);
    }
    if (typeof window !== "undefined" && window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
    setState({ status: "idle", key: null, fallback: false });
  }, []);

  const speakWithBrowser = useCallback((text: string, key: string) => {
    const synth = window.speechSynthesis;
    if (!synth) {
      setState({ status: "idle", key: null, fallback: false });
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
    utterance.lang = TAMIL.test(text) ? "ta-IN" : "en-IN";
    utterance.onend = utterance.onerror = () => setState((s) => (s.key === key ? { status: "idle", key: null, fallback: false } : s));
    setState({ status: "speaking", key, fallback: true });
    synth.speak(utterance);
  }, []);

  const speak = useCallback(
    async (text: string, key: string) => {
      stop();
      const abort = new AbortController();
      const entry: { abort: AbortController; audio: HTMLAudioElement | null; url: string | null } = { abort, audio: null, url: null };
      current.current = entry;
      setState({ status: "loading", key, fallback: false });
      try {
        const res = await fetch("/api/voice/speech", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.slice(0, 2000) }),
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`speech ${res.status}`);
        const blob = await res.blob();
        if (current.current !== entry) return; // interrupted while loading
        entry.url = URL.createObjectURL(blob);
        entry.audio = new Audio(entry.url);
        entry.audio.onended = () => {
          if (current.current === entry) stop();
        };
        setState({ status: "speaking", key, fallback: false });
        await entry.audio.play();
      } catch (err) {
        if (abort.signal.aborted || current.current !== entry) return; // user stopped it
        console.warn("[voice] neural speech failed, using browser voice", err);
        current.current = null;
        speakWithBrowser(text, key);
      }
    },
    [stop, speakWithBrowser],
  );

  useEffect(() => stop, [stop]);

  return { ...state, speak, stop };
}
