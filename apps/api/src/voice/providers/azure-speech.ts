import { Inject, Injectable } from "@nestjs/common";
import type { VoiceOption } from "@personalos/contracts";
import { ENV, type Env } from "../../config/env.js";
import {
  type SpeechToTextProvider,
  type SynthesizedAudio,
  type SynthesizeInput,
  type TextToSpeechProvider,
  type Transcript,
  type TranscribeInput,
  VoiceProviderError,
} from "./types.js";

const STT_API_VERSION = "2025-10-15";
const STT_TIMEOUT_MS = 30_000;
const TTS_TIMEOUT_MS = 20_000;

/** Maps an Azure HTTP status to a provider-neutral error kind. Auth failures surface as "unavailable". */
function errorFor(status: number, provider: string, detail: string): VoiceProviderError {
  if (status === 429) return new VoiceProviderError("rate_limited", provider, "rate limited");
  if (status === 400 || status === 415 || status === 422) return new VoiceProviderError("bad_audio", provider, detail);
  if (status === 401 || status === 403) return new VoiceProviderError("unavailable", provider, `auth rejected (${status})`);
  return new VoiceProviderError("upstream", provider, `HTTP ${status}`);
}

function withTimeout(signal: AbortSignal | undefined, ms: number) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

function rethrow(err: unknown, provider: string): never {
  if (err instanceof VoiceProviderError) throw err;
  if (err instanceof DOMException && err.name === "TimeoutError") throw new VoiceProviderError("timeout", provider, "timed out");
  if (err instanceof DOMException && err.name === "AbortError") throw err; // caller cancelled
  throw new VoiceProviderError("upstream", provider, (err as Error).message);
}

/**
 * Azure fast transcription (synchronous REST). Verified in spike 0002 with browser
 * containers: WebM/Opus, Ogg/Opus and WAV; ta-IN and en-IN; candidate-locale language ID.
 */
@Injectable()
export class AzureSpeechToText implements SpeechToTextProvider {
  readonly id = "azure";
  readonly acceptedMimeTypes = ["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/aac"] as const;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured() {
    return !!(this.env.AZURE_SPEECH_KEY && this.env.AZURE_SPEECH_REGION);
  }

  async transcribe({ audio, mimeType, locales, signal }: TranscribeInput): Promise<Transcript> {
    if (!this.isConfigured()) throw new VoiceProviderError("unavailable", this.id, "not configured");
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(audio)], { type: mimeType }), "audio");
    form.append("definition", JSON.stringify({ locales, profanityFilterMode: "Masked" }));

    try {
      const res = await fetch(
        `https://${this.env.AZURE_SPEECH_REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${STT_API_VERSION}`,
        { method: "POST", headers: { "Ocp-Apim-Subscription-Key": this.env.AZURE_SPEECH_KEY! }, body: form, signal: withTimeout(signal, STT_TIMEOUT_MS) },
      );
      if (!res.ok) throw errorFor(res.status, this.id, (await res.text()).slice(0, 200));
      const body = (await res.json()) as {
        durationMilliseconds?: number;
        combinedPhrases?: Array<{ text?: string }>;
        phrases?: Array<{ locale?: string; confidence?: number; durationMilliseconds?: number }>;
      };
      const phrases = body.phrases ?? [];
      // Duration-weighted confidence across phrases; first phrase's locale (single-speaker push-to-talk).
      const totalMs = phrases.reduce((s, p) => s + (p.durationMilliseconds ?? 0), 0);
      const confidence =
        phrases.length && totalMs > 0
          ? phrases.reduce((s, p) => s + (p.confidence ?? 0) * (p.durationMilliseconds ?? 0), 0) / totalMs
          : (phrases[0]?.confidence ?? null);
      return {
        text: (body.combinedPhrases ?? []).map((p) => p.text ?? "").join(" ").trim(),
        locale: phrases[0]?.locale ?? null,
        confidence,
        durationMs: body.durationMilliseconds ?? null,
      };
    } catch (err) {
      rethrow(err, this.id);
    }
  }
}

/** Curated, validated voice list. Only these ids can reach SSML (no user-controlled markup). */
const AZURE_VOICES: VoiceOption[] = [
  { id: "en-IN-NeerjaNeural", label: "Neerja", locale: "en-IN", gender: "female" },
  { id: "en-IN-PrabhatNeural", label: "Prabhat", locale: "en-IN", gender: "male" },
  { id: "en-IN-AartiNeural", label: "Aarti", locale: "en-IN", gender: "female" },
  { id: "en-IN-ArjunNeural", label: "Arjun", locale: "en-IN", gender: "male" },
  { id: "en-IN-KavyaNeural", label: "Kavya", locale: "en-IN", gender: "female" },
  { id: "en-IN-KunalNeural", label: "Kunal", locale: "en-IN", gender: "male" },
  { id: "ta-IN-PallaviNeural", label: "Pallavi", locale: "ta-IN", gender: "female" },
  { id: "ta-IN-ValluvarNeural", label: "Valluvar", locale: "ta-IN", gender: "male" },
];

export const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildSsml({ text, locale, voice, rate }: Pick<SynthesizeInput, "text" | "locale" | "voice" | "rate">) {
  const pct = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  const prosody = `${pct >= 0 ? "+" : ""}${pct}%`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${escapeXml(voice)}"><prosody rate="${prosody}">${escapeXml(text)}</prosody></voice></speak>`;
}

@Injectable()
export class AzureTextToSpeech implements TextToSpeechProvider {
  readonly id = "azure";
  constructor(@Inject(ENV) private readonly env: Env) {}

  isConfigured() {
    return !!(this.env.AZURE_SPEECH_KEY && this.env.AZURE_SPEECH_REGION);
  }

  voices() {
    return AZURE_VOICES;
  }

  async synthesize(input: SynthesizeInput): Promise<SynthesizedAudio> {
    if (!this.isConfigured()) throw new VoiceProviderError("unavailable", this.id, "not configured");
    if (!AZURE_VOICES.some((v) => v.id === input.voice && v.locale === input.locale)) {
      throw new VoiceProviderError("bad_audio", this.id, `voice ${input.voice} not allowed for ${input.locale}`);
    }
    try {
      const res = await fetch(`https://${this.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.env.AZURE_SPEECH_KEY!,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
          "User-Agent": "personalos-api",
        },
        body: buildSsml(input),
        signal: withTimeout(input.signal, TTS_TIMEOUT_MS),
      });
      if (!res.ok || !res.body) throw errorFor(res.status, this.id, (await res.text()).slice(0, 200));
      return { mimeType: "audio/mpeg", stream: res.body };
    } catch (err) {
      rethrow(err, this.id);
    }
  }
}
