# Spike 0002 — Azure Speech for push-to-talk (STT + TTS)

- **Date:** 2026-10-31
- **Scripts:** `spikes/voice/voice-spike.mjs`, `spikes/voice/voice-spike-locales.mjs` (raw results: `spikes/voice/results.json`)
- **Resource used:** the existing eval project's Azure Speech key (region `eastus`, **F0 free tier**), read at runtime; not copied into PersonalOS.
- **Method:** Azure TTS generated the test audio in the containers browsers record (WebM/Opus = Chrome/Edge/Firefox `MediaRecorder` default, Ogg/Opus, 16 kHz WAV), then each was sent to speech-to-text. TTS audio is clean studio speech: accuracy on a real microphone is still to be checked in the browser.

## Results

### Speech to text: fast transcription API (`/speechtotext/transcriptions:transcribe?api-version=2025-10-15`)

| Sample | Container | Locales | HTTP | Latency | Result |
|---|---|---|---|---|---|
| English (7.0 s) | WebM/Opus | en-IN | 200 | 1962 ms (cold) | exact, conf 0.97 |
| English | Ogg/Opus | en-IN | 200 | 2011 ms | exact, conf 0.97 |
| English | WAV 16 kHz | en-IN | 200 | 1092 ms | exact, conf 0.97 |
| Tamil (4.7 s) | WebM/Opus | ta-IN | 200 | 519 ms | exact, conf 0.87 |
| Tamil | Ogg/Opus | ta-IN | 200 | 457 ms | exact |
| Tamil | WAV | ta-IN | 200 | 766 ms | exact |
| Tamil | WebM/Opus | *(none: auto)* | 200 | 532 ms | ❌ "Kaalai vanakkam, injoy yen atta vanail…" detected en-US, conf 0.28 |
| Tamil | WebM/Opus | en-IN, ta-IN | 200 | 465 ms | ✅ exact, detected ta-IN |
| English | WebM/Opus | en-IN, ta-IN | 200 | 2979 ms | ✅ exact, detected en-IN |
| Tanglish (5.4 s) | WebM/Opus | en-IN | 200 | 510 ms | ⚠️ "Nalakku manager kood meeting schedule pannu, morning 10:00 o'clock." conf 0.65 |
| Tanglish | WebM/Opus | ta-IN | 200 | 1642 ms | ❌ "நாலேக்குகூட்." conf 0.37 |
| Tanglish | WebM/Opus | en-IN, ta-IN | 200 | 1476 ms | ⚠️ picked en-IN; "Nalekko manager **could** meeting…" (meaning drift) |

### Text to speech: REST (`/cognitiveservices/v1`, SSML)

- Time to first audio byte was **~290–360 ms** for one sentence (MP3/Ogg), and ~620 ms to the whole clip.
- **Tamil voices: only two**: `ta-IN-PallaviNeural` (F) and `ta-IN-ValluvarNeural` (M).
- **en-IN:** 20+ voices, including `en-IN-NeerjaNeural` (with styles) and the HD voices `en-IN-*:DragonHDLatestNeural`.

### Other
- **F0 rate limit:** fast transcription returned **429** after about 10 calls in a minute ("exceeded call rate limit of your current SpeechServices F0 pricing tier"). F0 is not usable for daily use.
- **Short-audio REST** (`{region}.stt.speech.microsoft.com/.../cognitiveservices/v1`) returned 401 for every format on this resource. Not investigated, because fast transcription supersedes it here.

## Conclusions

1. **Record WebM/Opus in the browser with the native `MediaRecorder`** and send it as-is. No WAV/AudioWorklet encoder is needed. Safari records `audio/mp4` (AAC): the docs list AAC, but this still needs a browser test.
2. **Never use auto-detect without locales.** Use the user's language, or the candidate list `["en-IN","ta-IN"]` for "Auto".
3. **Tanglish is not solved by Azure.** The editable transcript plus an LLM that tolerates romanised Tamil reduces the impact; a Sarvam provider is the evaluation path (the eval project already has keys and findings).
4. **TTS latency is low enough to speak the final answer** without sentence-level streaming in the MVP.
5. **PersonalOS needs its own S0 Speech resource,** preferably in Central India for latency.
