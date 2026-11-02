import { Module } from "@nestjs/common";
import { AzureSpeechToText, AzureTextToSpeech } from "./providers/azure-speech.js";
import { STT_PROVIDERS, TTS_PROVIDERS } from "./providers/types.js";
import { VoiceController } from "./voice.controller.js";
import { VoiceService } from "./voice.service.js";

/**
 * Providers are registered as lists; the user's preference picks one by id.
 * Adding Sarvam = one class + one entry here. Tests override the lists with fakes.
 */
@Module({
  controllers: [VoiceController],
  providers: [
    AzureSpeechToText,
    AzureTextToSpeech,
    { provide: STT_PROVIDERS, useFactory: (azure: AzureSpeechToText) => [azure], inject: [AzureSpeechToText] },
    { provide: TTS_PROVIDERS, useFactory: (azure: AzureTextToSpeech) => [azure], inject: [AzureTextToSpeech] },
    VoiceService,
  ],
  exports: [VoiceService],
})
export class VoiceModule {}
