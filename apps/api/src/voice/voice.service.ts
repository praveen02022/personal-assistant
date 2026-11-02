import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  ErrorCodes,
  type SpeechLocale,
  type SpeechRequest,
  type TranscriptionResponse,
  type UpdateVoicePreferences,
  type VoiceLanguage,
  type VoicePreferences,
  type VoiceSettings,
} from "@personalos/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  STT_PROVIDERS,
  type SpeechToTextProvider,
  type SynthesizedAudio,
  TTS_PROVIDERS,
  type TextToSpeechProvider,
  VoiceProviderError,
} from "./providers/types.js";
import { detectSpeechLocale, toSpeakableText } from "./speech-text.js";

/** Roughly 80 seconds of speech; longer answers are cut at a sentence and the rest stays on screen. */
const MAX_SPOKEN_CHARS = 1_200;

const DEFAULTS: VoicePreferences = {
  language: "auto",
  sttProvider: "azure",
  ttsProvider: "azure",
  voiceEn: "en-IN-NeerjaNeural",
  voiceTa: "ta-IN-PallaviNeural",
  speechRate: 1,
  autoSpeak: true,
};

export const baseMimeType = (mime: string) => mime.split(";")[0]!.trim().toLowerCase();

@Injectable()
export class VoiceService {
  private readonly logger = new Logger("Voice");

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(STT_PROVIDERS) private readonly sttProviders: SpeechToTextProvider[],
    @Inject(TTS_PROVIDERS) private readonly ttsProviders: TextToSpeechProvider[],
  ) {}

  isAvailable() {
    return this.sttProviders.some((p) => p.isConfigured()) && this.ttsProviders.some((p) => p.isConfigured());
  }

  async preferences(userId: string): Promise<VoicePreferences> {
    const row = await this.prisma.voicePreference.findUnique({ where: { userId } });
    if (!row) return DEFAULTS;
    return {
      language: row.language as VoiceLanguage,
      sttProvider: row.sttProvider,
      ttsProvider: row.ttsProvider,
      voiceEn: row.voiceEn,
      voiceTa: row.voiceTa,
      speechRate: row.speechRate,
      autoSpeak: row.autoSpeak,
    };
  }

  async settings(userId: string): Promise<VoiceSettings> {
    const preferences = await this.preferences(userId);
    return { available: this.isAvailable(), preferences, voices: this.tts(preferences.ttsProvider).voices() };
  }

  async updatePreferences(userId: string, patch: UpdateVoicePreferences): Promise<VoicePreferences> {
    const current = await this.preferences(userId);
    const next = { ...current, ...patch };
    const voices = this.tts(next.ttsProvider).voices();
    const valid = (id: string, locale: SpeechLocale) => voices.some((v) => v.id === id && v.locale === locale);
    if (!valid(next.voiceEn, "en-IN") || !valid(next.voiceTa, "ta-IN")) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Unknown voice for that language");
    }
    const { sttProvider, ttsProvider, ...data } = next;
    await this.prisma.voicePreference.upsert({
      where: { userId },
      create: { userId, sttProvider, ttsProvider, ...data },
      update: data,
    });
    await this.audit.record({ userId, action: "voice.preferences_updated", resourceType: "voice_preference", resourceId: userId, metadata: { fields: Object.keys(patch) } });
    return next;
  }

  async transcribe(
    userId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    languageOverride: VoiceLanguage | undefined,
    signal: AbortSignal,
  ): Promise<TranscriptionResponse> {
    const prefs = await this.preferences(userId);
    const provider = this.stt(prefs.sttProvider);
    const mimeType = baseMimeType(file.mimetype);
    if (!provider.acceptedMimeTypes.includes(mimeType)) {
      throw new AppError(ErrorCodes.UNSUPPORTED_AUDIO, HttpStatus.UNSUPPORTED_MEDIA_TYPE, `Audio format ${mimeType} is not supported`);
    }
    const language = languageOverride ?? prefs.language;
    // Spike 0002: unconstrained auto-detect mangles Tamil; always pass candidate locales.
    const locales: SpeechLocale[] = language === "auto" ? ["en-IN", "ta-IN"] : [language];

    const started = Date.now();
    const transcript = await this.callProvider(() => provider.transcribe({ audio: file.buffer, mimeType, locales, signal }));
    await this.audit.record({
      userId,
      action: "voice.transcribed",
      resourceType: "voice",
      // Metadata only: never the audio or the transcript text.
      metadata: { provider: provider.id, bytes: file.size, mimeType, audioMs: transcript.durationMs, locale: transcript.locale, latencyMs: Date.now() - started, empty: !transcript.text },
    });
    if (!transcript.text) throw new AppError(ErrorCodes.NO_SPEECH, HttpStatus.UNPROCESSABLE_ENTITY, "I couldn't hear any speech. Try again a little closer to the mic.");
    return transcript;
  }

  async speak(userId: string, req: SpeechRequest, signal: AbortSignal): Promise<SynthesizedAudio> {
    const prefs = await this.preferences(userId);
    const provider = this.tts(prefs.ttsProvider);
    const text = toSpeakableText(req.text, MAX_SPOKEN_CHARS);
    if (!text) throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Nothing to speak");
    const locale = req.locale ?? detectSpeechLocale(text);
    const voice = locale === "ta-IN" ? prefs.voiceTa : prefs.voiceEn;
    const audio = await this.callProvider(() => provider.synthesize({ text, locale, voice, rate: prefs.speechRate, signal }));
    await this.audit.record({ userId, action: "voice.synthesized", resourceType: "voice", metadata: { provider: provider.id, chars: text.length, locale, voice } });
    return audio;
  }

  private stt(id: string) {
    const p = this.sttProviders.find((x) => x.id === id && x.isConfigured());
    if (!p) throw this.unavailable();
    return p;
  }

  private tts(id: string) {
    const p = this.ttsProviders.find((x) => x.id === id);
    if (!p) throw this.unavailable();
    return p;
  }

  private unavailable() {
    return new AppError(ErrorCodes.VOICE_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, "Voice is not available right now.", { retryable: true });
  }

  /** Provider-neutral error mapping to stable API errors. Provider details go to logs only. */
  private async callProvider<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof VoiceProviderError)) throw err;
      this.logger.warn(`voice provider error: ${err.kind} ${err.message}`);
      switch (err.kind) {
        case "rate_limited":
          throw new AppError(ErrorCodes.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS, "Voice is busy right now. Try again in a moment, or type instead.", { retryable: true });
        case "bad_audio":
          throw new AppError(ErrorCodes.UNSUPPORTED_AUDIO, HttpStatus.UNPROCESSABLE_ENTITY, "That recording couldn't be processed. Please try again.");
        default:
          throw this.unavailable();
      }
    }
  }
}
