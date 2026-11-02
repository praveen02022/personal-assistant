"use client";

import { VOICE_LIMITS } from "@personalos/contracts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/** Container preference: all verified with Azure fast transcription (spike 0002) except mp4 (Safari, AAC). */
const CANDIDATE_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4", "audio/webm"];

export function pickMimeType(isSupported: (type: string) => boolean): string | null {
  return CANDIDATE_TYPES.find((t) => isSupported(t)) ?? null;
}

/** Human message for getUserMedia / MediaRecorder failures. */
export function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it in your browser's site settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found.";
    case "NotReadableError":
      return "The microphone is in use by another app.";
    default:
      return "Couldn't start the microphone.";
  }
}

export type RecorderState = "idle" | "requesting" | "recording";
export type Recording = { blob: Blob; durationMs: number };

/**
 * Push-to-talk recorder: native MediaRecorder (no custom encoder), a live input level from
 * an AnalyserNode (a real signal, not an animation), and hard limits from the shared contract.
 * The microphone is released as soon as recording stops.
 */
export function useRecorder({ onRecorded, onError }: { onRecorded: (r: Recording) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const session = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    audioCtx: AudioContext;
    raf: number;
    startedAt: number;
    cancelled: boolean;
    limitTimer: number;
  } | null>(null);
  /**
   * Bumped by every start, cancel and unmount. A permission grant that resolves after the user
   * cancelled or navigated away sees a different generation and releases the microphone at once.
   */
  const generation = useRef(0);
  const mounted = useRef(false);
  // Latest callbacks for MediaRecorder events, without restarting the recorder when they change.
  const callbacks = useRef({ onRecorded, onError });
  useLayoutEffect(() => {
    callbacks.current = { onRecorded, onError };
  });

  const release = useCallback(() => {
    const s = session.current;
    if (!s) return;
    cancelAnimationFrame(s.raf);
    clearTimeout(s.limitTimer);
    s.stream.getTracks().forEach((t) => t.stop()); // turns the browser's mic indicator off
    void s.audioCtx.close().catch(() => undefined);
    session.current = null;
    setLevel(0);
    setElapsedMs(0);
    setState("idle");
  }, []);

  const stop = useCallback(() => {
    const r = session.current?.recorder;
    if (r && r.state !== "inactive") r.stop();
  }, []);

  /** Cancels a recording in progress *or* a pending permission request; nothing is transcribed. */
  const cancel = useCallback(() => {
    generation.current++;
    if (session.current) {
      session.current.cancelled = true;
      stop();
    } else if (mounted.current) {
      setState("idle"); // was "requesting": the late grant will be discarded
    }
  }, [stop]);

  const start = useCallback(async () => {
    if (session.current) return;
    const gen = ++generation.current;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      callbacks.current.onError(window.isSecureContext ? "This browser can't record audio." : "Voice input needs a secure (HTTPS) connection.");
      return;
    }
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      callbacks.current.onError("This browser can't record in a supported audio format.");
      return;
    }
    setState("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (err) {
      if (gen !== generation.current || !mounted.current) return; // cancelled meanwhile: stay quiet
      setState("idle");
      callbacks.current.onError(micErrorMessage(err));
      return;
    }
    if (gen !== generation.current || !mounted.current) {
      // Cancelled, restarted or unmounted while the permission prompt was open.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const audioCtx = new AudioContext();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);

    const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const s = session.current;
      const durationMs = s ? performance.now() - s.startedAt : 0;
      const cancelled = s?.cancelled ?? true;
      release();
      if (cancelled) return;
      if (durationMs < VOICE_LIMITS.minRecordingMs) {
        callbacks.current.onError("That was too short. Hold the mic while you speak.");
        return;
      }
      callbacks.current.onRecorded({ blob: new Blob(chunks, { type: recorder.mimeType || mimeType }), durationMs });
    };

    const startedAt = performance.now();
    let lastPaint = 0;
    const tick = (now: number) => {
      const s = session.current;
      if (!s) return;
      if (now - lastPaint > 50) {
        // ~20 fps: RMS of the waveform, scaled for speech (quiet room ~0.01, speech ~0.05-0.2)
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) sum += v * v;
        setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 6));
        setElapsedMs(now - s.startedAt);
        lastPaint = now;
      }
      s.raf = requestAnimationFrame(tick);
    };
    session.current = {
      recorder,
      stream,
      audioCtx,
      startedAt,
      cancelled: false,
      raf: requestAnimationFrame(tick),
      limitTimer: window.setTimeout(() => recorder.state !== "inactive" && recorder.stop(), VOICE_LIMITS.maxRecordingMs),
    };
    recorder.start(250);
    setState("recording");
  }, [release]);

  // Never leave the microphone open when the component goes away, including a pending prompt.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  return { state, level, elapsedMs, start, stop, cancel };
}
