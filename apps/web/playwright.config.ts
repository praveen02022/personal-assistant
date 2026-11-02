import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/** Each project feeds a different WAV file to Chrome as the microphone. */
const mic = (wav: string) => ({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream", // auto-grant; denial is simulated in-page
      `--use-file-for-fake-audio-capture=${path.join(import.meta.dirname, "e2e/fixtures", wav)}%noloop`,
    ],
  },
});

/**
 * Live end-to-end tests: real web + API + OpenClaw Gateway + Azure Speech.
 * Uses the locally installed Google Chrome (no browser download) with Chrome's fake
 * audio capture, so recorded WAV files stand in for a microphone.
 * Prerequisites: all services running (see README). Run: pnpm --filter @personalos/web test:e2e:live
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // one Azure F0 key, one conversation lane per test
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: "chrome",
    storageState: "e2e/.auth/owner.json", // written by global-setup (one login per run)
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "mic-english", grep: /@en\b/, use: mic("en.wav") },
    { name: "mic-tamil", grep: /@ta\b/, use: mic("ta.wav") },
    { name: "mic-silence", grep: /@silence\b/, use: mic("silence.wav") },
    { name: "no-mic", grep: /@nomic\b/ },
    // UI: demo flow, themes, keyboard, contrast (axe) and screenshots; desktop and phone.
    { name: "ui", grep: /@ui\b/, use: { viewport: { width: 1440, height: 900 } } },
    { name: "ui-mobile", grep: /@mobile\b/, use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
