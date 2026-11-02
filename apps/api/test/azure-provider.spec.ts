import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env.js";
import { AzureSpeechToText, AzureTextToSpeech } from "../src/voice/providers/azure-speech.js";
import { VoiceProviderError } from "../src/voice/providers/types.js";

const env = { AZURE_SPEECH_KEY: "k".repeat(32), AZURE_SPEECH_REGION: "centralindia" } as Env;
const audio = { audio: Buffer.from("fake-webm"), mimeType: "audio/webm" };

afterEach(() => vi.unstubAllGlobals());

describe("AzureSpeechToText", () => {
  it("calls fast transcription with the candidate locales and parses the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          durationMilliseconds: 4675,
          combinedPhrases: [{ text: "காலை வணக்கம்." }],
          phrases: [
            { locale: "ta-IN", confidence: 0.9, durationMilliseconds: 3000 },
            { locale: "ta-IN", confidence: 0.6, durationMilliseconds: 1000 },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new AzureSpeechToText(env).transcribe({ ...audio, locales: ["en-IN", "ta-IN"] });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://centralindia.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15");
    expect((init.headers as Record<string, string>)["Ocp-Apim-Subscription-Key"]).toBe(env.AZURE_SPEECH_KEY);
    const form = init.body as FormData;
    expect(JSON.parse(form.get("definition") as string)).toMatchObject({ locales: ["en-IN", "ta-IN"] });
    expect((form.get("audio") as Blob).type).toBe("audio/webm");

    expect(result).toEqual({ text: "காலை வணக்கம்.", locale: "ta-IN", confidence: 0.825, durationMs: 4675 }); // duration-weighted
  });

  it("maps F0 throttling (429) to rate_limited and auth failures to unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    await expect(new AzureSpeechToText(env).transcribe({ ...audio, locales: ["en-IN"] })).rejects.toMatchObject({ kind: "rate_limited" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await expect(new AzureSpeechToText(env).transcribe({ ...audio, locales: ["en-IN"] })).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("refuses to run unconfigured", async () => {
    await expect(new AzureSpeechToText({} as Env).transcribe({ ...audio, locales: ["en-IN"] })).rejects.toBeInstanceOf(VoiceProviderError);
  });
});

describe("AzureTextToSpeech", () => {
  it("only accepts allow-listed voices for the requested locale", async () => {
    const tts = new AzureTextToSpeech(env);
    await expect(tts.synthesize({ text: "hi", locale: "en-IN", voice: "ta-IN-PallaviNeural", rate: 1 })).rejects.toMatchObject({ kind: "bad_audio" });
    await expect(tts.synthesize({ text: "hi", locale: "en-IN", voice: "en-IN-Evil'/><x", rate: 1 })).rejects.toMatchObject({ kind: "bad_audio" });
  });

  it("requests MP3 SSML and returns the audio stream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await new AzureTextToSpeech(env).synthesize({ text: "வணக்கம்", locale: "ta-IN", voice: "ta-IN-PallaviNeural", rate: 1 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1");
    expect((init.headers as Record<string, string>)["X-Microsoft-OutputFormat"]).toBe("audio-24khz-48kbitrate-mono-mp3");
    expect(init.body as string).toContain('<voice name="ta-IN-PallaviNeural">');
    expect(out.mimeType).toBe("audio/mpeg");
  });
});
