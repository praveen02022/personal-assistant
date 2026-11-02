import type { VoiceOption } from "@personalos/contracts";
import type { SpeechToTextProvider, SynthesizeInput, TextToSpeechProvider, Transcript, TranscribeInput } from "../../src/voice/providers/types.js";
import { VoiceProviderError } from "../../src/voice/providers/types.js";

export class FakeStt implements SpeechToTextProvider {
  readonly id = "azure";
  readonly acceptedMimeTypes = ["audio/webm", "audio/ogg", "audio/wav"];
  calls: Array<Omit<TranscribeInput, "audio" | "signal"> & { bytes: number; abortedDuringCall: boolean }> = [];
  next: Transcript | VoiceProviderError = { text: "what is on my schedule today", locale: "en-IN", confidence: 0.93, durationMs: 2100 };
  delayMs = 30;

  isConfigured() {
    return true;
  }

  async transcribe(input: TranscribeInput): Promise<Transcript> {
    // Simulate provider latency, then check the request was not cancelled by a healthy client.
    await new Promise((r) => setTimeout(r, this.delayMs));
    this.calls.push({ mimeType: input.mimeType, locales: input.locales, bytes: input.audio.length, abortedDuringCall: input.signal?.aborted ?? false });
    if (this.next instanceof VoiceProviderError) throw this.next;
    return this.next;
  }
}

export class FakeTts implements TextToSpeechProvider {
  readonly id = "azure";
  calls: SynthesizeInput[] = [];

  isConfigured() {
    return true;
  }

  voices(): VoiceOption[] {
    return [
      { id: "en-IN-NeerjaNeural", label: "Neerja", locale: "en-IN", gender: "female" },
      { id: "en-IN-PrabhatNeural", label: "Prabhat", locale: "en-IN", gender: "male" },
      { id: "ta-IN-PallaviNeural", label: "Pallavi", locale: "ta-IN", gender: "female" },
    ];
  }

  async synthesize(input: SynthesizeInput) {
    this.calls.push(input);
    await Promise.resolve();
    return { mimeType: "audio/mpeg", stream: new Blob([Buffer.from("ID3-fake-mp3")]).stream() };
  }
}
