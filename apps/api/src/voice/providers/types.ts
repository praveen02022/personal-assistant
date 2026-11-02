import type { SpeechLocale, VoiceOption } from "@personalos/contracts";

/**
 * Provider-neutral voice contracts. Business logic (VoiceService, controllers, UI) depends
 * only on these; Azure, Sarvam, browser speech, etc. are interchangeable implementations.
 */

export type TranscribeInput = {
  audio: Buffer;
  /** Container/codec as recorded, e.g. "audio/webm" (base type, parameters stripped). */
  mimeType: string;
  /** Candidate locales. One = fixed language; several = provider picks among them. Never empty. */
  locales: SpeechLocale[];
  signal?: AbortSignal;
};

export type Transcript = {
  text: string;
  locale: string | null;
  /** 0..1 when the provider reports it. */
  confidence: number | null;
  durationMs: number | null;
};

export interface SpeechToTextProvider {
  readonly id: string;
  isConfigured(): boolean;
  /** Container base types this provider accepts. */
  readonly acceptedMimeTypes: readonly string[];
  transcribe(input: TranscribeInput): Promise<Transcript>;
}

/**
 * Optional extension for live partial transcripts (full-duplex voice, later phase).
 * Declared now so the shape is agreed; nothing implements it yet.
 */
export interface StreamingSpeechToTextProvider extends SpeechToTextProvider {
  transcribeStream(input: { audio: AsyncIterable<Buffer>; mimeType: string; locales: SpeechLocale[]; signal?: AbortSignal }): AsyncIterable<{ text: string; final: boolean }>;
}

export type SynthesizeInput = {
  text: string;
  locale: SpeechLocale;
  voice: string;
  /** 1.0 = normal; 0.5..2. */
  rate: number;
  signal?: AbortSignal;
};

export type SynthesizedAudio = { mimeType: string; stream: ReadableStream<Uint8Array> };

export interface TextToSpeechProvider {
  readonly id: string;
  isConfigured(): boolean;
  voices(): VoiceOption[];
  synthesize(input: SynthesizeInput): Promise<SynthesizedAudio>;
}

export type VoiceErrorKind = "unavailable" | "rate_limited" | "bad_audio" | "upstream" | "timeout";

export class VoiceProviderError extends Error {
  constructor(
    readonly kind: VoiceErrorKind,
    readonly provider: string,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

export const STT_PROVIDERS = Symbol("STT_PROVIDERS");
export const TTS_PROVIDERS = Symbol("TTS_PROVIDERS");
