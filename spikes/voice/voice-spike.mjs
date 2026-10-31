/**
 * Voice spike: verify Azure Speech formats, locales and latency before designing Phase 2.
 *   node spikes/voice/voice-spike.mjs <path-to-env-with-AZURE_SPEECH_KEY/REGION>
 * The key is read at runtime and never printed or written anywhere.
 *
 * Audio under test is produced by Azure TTS itself in the containers browsers record:
 *   webm/opus  ~ Chrome/Edge/Firefox MediaRecorder default
 *   ogg/opus   ~ Firefox option
 *   wav/pcm16k ~ what we'd produce with an AudioWorklet recorder
 * Caveat: TTS audio is clean studio speech; real-microphone accuracy is validated in-browser later.
 */
import fs from "node:fs";
import path from "node:path";

const envFile = process.argv[2];
if (!envFile) throw new Error("usage: node voice-spike.mjs <env file>");
process.loadEnvFile(envFile);
const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
if (!KEY || !REGION) throw new Error("AZURE_SPEECH_KEY / AZURE_SPEECH_REGION missing");

const OUT = path.join(import.meta.dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (r) => {
  results.push(r);
  console.log(JSON.stringify(r));
};

// ---------- 1. voices ----------
const t0 = performance.now();
const voices = await (await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { headers: { "Ocp-Apim-Subscription-Key": KEY } })).json();
const pick = (loc) => voices.filter((v) => v.Locale === loc).map((v) => `${v.ShortName} (${v.Gender}${v.VoiceType && v.VoiceType !== "Neural" ? `, ${v.VoiceType}` : ""})`);
log({ step: "voices", ms: Math.round(performance.now() - t0), total: voices.length, "ta-IN": pick("ta-IN"), "en-IN": pick("en-IN").slice(0, 30) });

// ---------- 2. TTS ----------
const SAMPLES = [
  { id: "en", locale: "en-IN", voice: "en-IN-NeerjaNeural", text: "Good morning. What is on my schedule today, and do I have any meetings after lunch?" },
  { id: "ta", locale: "ta-IN", voice: "ta-IN-PallaviNeural", text: "காலை வணக்கம். இன்று என் அட்டவணையில் என்ன இருக்கிறது?" },
  // Tanglish: Tamil grammar in Latin script / English words. Spoken by the en-IN voice.
  { id: "tanglish", locale: "en-IN", voice: "en-IN-NeerjaNeural", text: "Naalaikku manager kooda meeting schedule pannu, morning ten o'clock." },
];

async function tts(sample, format) {
  const ssml = `<speak version="1.0" xml:lang="${sample.locale}"><voice name="${sample.voice}">${sample.text}</voice></speak>`;
  const start = performance.now();
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": KEY, "Content-Type": "application/ssml+xml", "X-Microsoft-OutputFormat": format, "User-Agent": "personalos-voice-spike" },
    body: ssml,
  });
  const reader = res.body.getReader();
  const chunks = [];
  let ttfb = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    ttfb ??= performance.now() - start;
    chunks.push(value);
  }
  const buf = Buffer.concat(chunks);
  return { status: res.status, buf, ttfbMs: Math.round(ttfb ?? -1), totalMs: Math.round(performance.now() - start) };
}

const FORMATS = {
  webm: { tts: "webm-24khz-16bit-mono-opus", mime: "audio/webm;codecs=opus" },
  ogg: { tts: "ogg-24khz-16bit-mono-opus", mime: "audio/ogg;codecs=opus" },
  wav: { tts: "riff-16khz-16bit-mono-pcm", mime: "audio/wav" },
  mp3: { tts: "audio-24khz-48kbitrate-mono-mp3", mime: "audio/mpeg" },
};

const audio = {};
for (const s of SAMPLES) {
  for (const [fmt, f] of Object.entries(FORMATS)) {
    const r = await tts(s, f.tts);
    const file = path.join(OUT, `${s.id}.${fmt}`);
    fs.writeFileSync(file, r.buf);
    audio[`${s.id}.${fmt}`] = r.buf;
    log({ step: "tts", sample: s.id, format: fmt, status: r.status, bytes: r.buf.length, ttfbMs: r.ttfbMs, totalMs: r.totalMs });
  }
}

// ---------- 3. STT: fast transcription ----------
async function fast(buf, mime, locales, apiVersion = "2025-10-15") {
  const form = new FormData();
  form.append("audio", new Blob([buf], { type: mime }), "audio");
  form.append("definition", JSON.stringify(locales ? { locales } : {}));
  const start = performance.now();
  const res = await fetch(`https://${REGION}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=${apiVersion}`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": KEY },
    body: form,
  });
  const body = await res.json().catch(() => null);
  return {
    status: res.status,
    ms: Math.round(performance.now() - start),
    text: body?.combinedPhrases?.map((p) => p.text).join(" ") ?? null,
    confidence: body?.phrases?.[0]?.confidence ?? null,
    locale: body?.phrases?.[0]?.locale ?? null,
    audioMs: body?.durationMilliseconds ?? null,
    error: res.ok ? null : JSON.stringify(body)?.slice(0, 220),
  };
}

for (const s of SAMPLES) {
  for (const fmt of ["webm", "ogg", "wav"]) {
    log({ step: "stt.fast", sample: s.id, format: fmt, locales: [s.locale], ...(await fast(audio[`${s.id}.${fmt}`], FORMATS[fmt].mime, [s.locale])) });
  }
}
// Locale handling: no locale (multilingual auto-detect) and candidate list for Tamil / Tanglish.
log({ step: "stt.fast", sample: "ta", format: "webm", locales: "none (auto)", ...(await fast(audio["ta.webm"], FORMATS.webm.mime, null)) });
log({ step: "stt.fast", sample: "ta", format: "webm", locales: ["en-IN", "ta-IN"], ...(await fast(audio["ta.webm"], FORMATS.webm.mime, ["en-IN", "ta-IN"])) });
log({ step: "stt.fast", sample: "tanglish", format: "webm", locales: ["ta-IN"], ...(await fast(audio["tanglish.webm"], FORMATS.webm.mime, ["ta-IN"])) });

// ---------- 4. STT: short-audio REST (the alternative) ----------
async function shortAudio(buf, contentType, language) {
  const start = performance.now();
  const res = await fetch(`https://${REGION}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${language}&format=detailed`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": KEY, "Content-Type": contentType, Accept: "application/json" },
    body: buf,
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, ms: Math.round(performance.now() - start), recognition: body?.RecognitionStatus ?? null, text: body?.DisplayText ?? null, error: res.ok ? null : text.slice(0, 160) };
}
for (const [fmt, ct] of [
  ["webm", "audio/webm; codecs=opus"],
  ["ogg", "audio/ogg; codecs=opus"],
  ["wav", "audio/wav; codecs=audio/pcm; samplerate=16000"],
]) {
  log({ step: "stt.short", sample: "en", format: fmt, ...(await shortAudio(audio[`en.${fmt}`], ct, "en-IN")) });
}

fs.writeFileSync(path.join(import.meta.dirname, "results.json"), JSON.stringify(results, null, 1));
console.log("\nwritten: spikes/voice/results.json");
