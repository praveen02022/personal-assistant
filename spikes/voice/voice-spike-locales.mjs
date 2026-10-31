/**
 * Follow-up: candidate-locale language ID for en / ta / Tanglish, spaced out for the F0 rate limit.
 *   node spikes/voice/voice-spike-locales.mjs <env file>
 */
import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

process.loadEnvFile(process.argv[2]);
const { AZURE_SPEECH_KEY: KEY, AZURE_SPEECH_REGION: REGION } = process.env;
const OUT = path.join(import.meta.dirname, "out");

async function fast(file, locales) {
  const form = new FormData();
  form.append("audio", new Blob([fs.readFileSync(path.join(OUT, file))], { type: "audio/webm;codecs=opus" }), "audio");
  form.append("definition", JSON.stringify({ locales }));
  const start = performance.now();
  const res = await fetch(`https://${REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": KEY },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return { file, locales, status: res.status, ms: Math.round(performance.now() - start), locale: body?.phrases?.[0]?.locale ?? null, confidence: body?.phrases?.[0]?.confidence ?? null, text: body?.combinedPhrases?.map((p) => p.text).join(" ") ?? JSON.stringify(body)?.slice(0, 120) };
}

const cases = [
  ["tanglish.webm", ["ta-IN"]],
  ["tanglish.webm", ["en-IN", "ta-IN"]],
  ["en.webm", ["en-IN", "ta-IN"]],
];
await sleep(45_000); // let the F0 window reset
for (const [file, locales] of cases) {
  console.log(JSON.stringify(await fast(file, locales)));
  await sleep(15_000);
}
