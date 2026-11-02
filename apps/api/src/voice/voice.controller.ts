import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { Body, Controller, Get, HttpStatus, Post, Put, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  ErrorCodes,
  SpeechRequest,
  type TranscriptionResponse,
  UpdateVoicePreferences,
  VOICE_LIMITS,
  VoiceLanguage,
  type VoicePreferences,
  type VoiceSettings,
} from "@personalos/contracts";
import type { Response } from "express";
import { memoryStorage } from "multer";
import { type AuthUser, CurrentUser } from "../auth/auth.decorators.js";
import { AppError } from "../common/errors.js";
import { ZodPipe } from "../common/zod-validation.pipe.js";
import { VoiceService } from "./voice.service.js";

/**
 * Aborts provider calls when the browser goes away (user cancelled or navigated).
 * Watches the *response*: the request's own "close" fires as soon as its body has been
 * read, which would cancel every call. A response closing before we finished = client gone.
 */
function abortOnDisconnect(res: Response) {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller.signal;
}

@Controller("voice")
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get("settings")
  settings(@CurrentUser() user: AuthUser): Promise<VoiceSettings> {
    return this.voice.settings(user.id);
  }

  @Put("preferences")
  update(@CurrentUser() user: AuthUser, @Body(new ZodPipe(UpdateVoicePreferences)) body: UpdateVoicePreferences): Promise<VoicePreferences> {
    return this.voice.updatePreferences(user.id, body);
  }

  /**
   * multipart/form-data: `audio` (the recording, kept in memory only) and optional `language`.
   * The audio is never written to disk or stored.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post("transcriptions")
  @UseInterceptors(FileInterceptor("audio", { storage: memoryStorage(), limits: { fileSize: VOICE_LIMITS.maxAudioBytes, files: 1, fields: 2, parts: 3 } }))
  async transcribe(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("language") language: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TranscriptionResponse> {
    if (!file?.buffer?.length) throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "No audio received");
    const lang = language === undefined || language === "" ? undefined : VoiceLanguage.safeParse(language);
    if (lang && !lang.success) throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, "Unsupported language");
    return this.voice.transcribe(user.id, file, lang?.data, abortOnDisconnect(res));
  }

  /** Streams synthesized speech (audio/mpeg) as it arrives from the provider. */
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post("speech")
  async speech(@CurrentUser() user: AuthUser, @Body(new ZodPipe(SpeechRequest)) body: SpeechRequest, @Res() res: Response) {
    const signal = abortOnDisconnect(res);
    const audio = await this.voice.speak(user.id, body, signal); // errors before any byte -> JSON error body
    res.status(200).set({ "Content-Type": audio.mimeType, "Cache-Control": "no-store" });
    await pipeline(Readable.fromWeb(audio.stream as NodeWebStream), res).catch(() => {
      // client disconnected mid-stream; the abort signal already cancelled the upstream request
    });
  }
}
