"use client";

import { LoaderCircle, Mic, X } from "lucide-react";
import { motion } from "motion/react";
import { useRef } from "react";
import type { RecorderState } from "@/lib/voice/recorder";
import { cn } from "@/lib/utils";

const HOLD_MS = 350;

type Props = {
  state: RecorderState;
  transcribing: boolean;
  level: number;
  disabledReason: string | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
};

/**
 * Push-to-talk. Hold to talk (release to finish), or tap once to start and again to stop.
 * Keyboard: Enter/Space toggles; Escape cancels.
 */
export function MicButton({ state, transcribing, level, disabledReason, onStart, onStop, onCancel }: Props) {
  const press = useRef<{ startedRecording: boolean; at: number } | null>(null);
  const active = state !== "idle";

  const label = transcribing
    ? "Transcribing"
    : state === "recording"
      ? "Stop recording"
      : state === "requesting"
        ? "Waiting for microphone permission"
        : (disabledReason ?? "Hold to talk, or tap to start recording");

  return (
    <div className="flex items-center gap-1">
      <motion.button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={state === "recording"}
        disabled={!!disabledReason || transcribing}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // keep focus in the composer
          press.current = { startedRecording: !active, at: performance.now() };
          if (!active) onStart();
        }}
        onPointerUp={() => {
          const p = press.current;
          press.current = null;
          if (!p) return;
          if (!p.startedRecording) onStop(); // second tap in toggle mode
          else if (performance.now() - p.at > HOLD_MS) onStop(); // hold-to-talk released
          // short tap that started recording: keep recording (toggle mode)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && active) {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            if (active) onStop();
            else onStart();
          }
        }}
        className={cn(
          "relative grid h-11 w-11 touch-none place-items-center rounded-lg transition-colors select-none disabled:pointer-events-none disabled:opacity-40 md:h-10 md:w-10",
          state === "recording" ? "bg-accent text-accent-ink" : state === "requesting" || transcribing ? "bg-accent-soft text-accent-soft-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
        )}
      >
        {state === "recording" && (
          // Halo scales with the real microphone level (AnalyserNode RMS).
          <motion.span aria-hidden className="absolute inset-0 rounded-lg bg-accent/30" animate={{ scale: 1 + level * 0.6 }} transition={{ duration: 0.08 }} />
        )}
        {transcribing || state === "requesting" ? <LoaderCircle className="relative h-4 w-4 animate-spin" aria-hidden /> : <Mic className="relative h-4 w-4" aria-hidden />}
      </motion.button>
      {(state === "recording" || state === "requesting" || transcribing) && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={transcribing ? "Cancel transcription" : "Cancel recording"}
          className="inline-flex h-11 items-center gap-1 rounded-lg px-2 text-label text-ink-2 hover:bg-surface-2 hover:text-ink md:h-8"
        >
          <X className="h-4 w-4" aria-hidden /> Cancel
        </button>
      )}
    </div>
  );
}

export function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
