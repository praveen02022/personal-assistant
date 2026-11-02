import fs from "node:fs";
import path from "node:path";
import { type Page, expect, test } from "@playwright/test";

/**
 * Phase 2 closure: the real voice pipeline in a real browser.
 *   fake mic (WAV) -> MediaRecorder -> /api/voice/transcriptions -> Azure -> editable draft
 *   -> Send -> OpenClaw -> SSE answer -> /api/voice/speech -> Azure TTS -> <audio>.play()
 * Failure paths (denial, races, cancellation, provider errors) use page instrumentation or
 * route interception, never mocks of our own code.
 */

const ORIGIN = "http://localhost:3000";
const OWNER = { email: "kalam@madhifoundation.org", password: fs.readFileSync(path.resolve(import.meta.dirname, "../../../.secrets/owner-password.txt"), "utf8").trim() };

declare global {
  interface Window {
    __gumMode?: "deny";
    __gumDelayMs?: number;
    __media: { gumCalls: number; recorderStarts: number; plays: number; pauses: number; tracks: MediaStreamTrack[] };
  }
}

/** Instruments getUserMedia, MediaRecorder and media playback so tests can assert real resource state. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    window.__media = { gumCalls: 0, recorderStarts: 0, plays: 0, pauses: 0, tracks: [] };
    const md = navigator.mediaDevices;
    const realGum = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      window.__media.gumCalls++;
      if (window.__gumMode === "deny") throw new DOMException("Permission denied", "NotAllowedError");
      if (window.__gumDelayMs) await new Promise((r) => setTimeout(r, window.__gumDelayMs)); // a slow permission prompt
      const stream = await realGum(constraints);
      stream.getTracks().forEach((t) => window.__media.tracks.push(t));
      return stream;
    };
    const realStart = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...args) {
      window.__media.recorderStarts++;
      return realStart.apply(this, args);
    };
    const realPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__media.plays++;
      return realPlay.call(this);
    };
    const realPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function () {
      window.__media.pauses++;
      return realPause.call(this);
    };
  });
}

const media = (page: Page) => page.evaluate(() => ({ ...window.__media, liveTracks: window.__media.tracks.filter((t) => t.readyState === "live").length, tracks: undefined }));
const mic = (page: Page) => page.getByRole("button", { name: /Hold to talk|Stop recording|Waiting for microphone|Transcribing/ });
const composer = (page: Page) => page.locator("#composer");
/** App alerts only (Next.js renders a hidden route announcer that also has role="alert"). */
const appAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** Tap-to-record for `ms`, then tap to stop. */
async function record(page: Page, ms: number) {
  await mic(page).click();
  await expect(page.getByText(/^Listening/)).toBeVisible();
  await page.waitForTimeout(ms);
  await page.getByRole("button", { name: "Stop recording" }).click();
}

async function sendAndAwaitSpokenAnswer(page: Page) {
  const speech = page.waitForResponse((r) => r.url().endsWith("/api/voice/speech") && r.request().method() === "POST", { timeout: 120_000 });
  await composer(page).press("Enter");
  const res = await speech;
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("audio/mpeg");
  await expect.poll(async () => (await media(page)).plays, { timeout: 15_000 }).toBeGreaterThan(0);
  return JSON.parse(res.request().postData() ?? "{}") as { text: string };
}

test.describe("English via fake microphone (en.wav) @en", () => {
  test.beforeEach(async ({ page }) => {
    await instrument(page);
    await page.goto("/assistant");
  });

  test("full flow: mic → Azure transcript → edit → send → OpenClaw → spoken answer", async ({ page }) => {
    const t0 = Date.now();
    await record(page, 7_600); // en.wav is 7.05 s
    await expect(page.getByText("Transcribing…")).toBeVisible();
    await expect(composer(page)).toHaveValue(/schedule/i, { timeout: 30_000 });
    const transcript = await composer(page).inputValue();
    await expect(page.getByText(/^From voice/)).toBeVisible();
    // The draft is editable before sending.
    await composer(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Answer in one short sentence.");
    const spoken = await sendAndAwaitSpokenAnswer(page);
    await expect(page.getByText("Answer in one short sentence.")).toBeVisible(); // the edited text was sent
    await expect(page.getByRole("status").filter({ hasText: /Speaking/ })).toBeVisible();
    expect((await media(page)).liveTracks).toBe(0); // mic released after recording
    test.info().annotations.push(
      { type: "transcript", description: transcript },
      { type: "spoken", description: spoken.text.slice(0, 160) },
      { type: "total-ms", description: String(Date.now() - t0) },
    );
  });

  test("navigating away while recording releases the mic and transcribes nothing", async ({ page }) => {
    const uploads: string[] = [];
    page.on("request", (r) => r.url().includes("/api/voice/transcriptions") && uploads.push(r.url()));
    await mic(page).click();
    await expect(page.getByText(/^Listening/)).toBeVisible();
    await page.waitForTimeout(1_500);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect.poll(async () => (await media(page)).liveTracks).toBe(0);
    await page.waitForTimeout(1_000);
    expect(uploads).toHaveLength(0);
  });

  test("Esc while the permission prompt is pending: a late grant never records", async ({ page }) => {
    await page.evaluate(() => (window.__gumDelayMs = 1_500));
    await composer(page).click();
    await mic(page).click();
    await expect(page.getByText("Allow microphone access to talk…")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2_500); // the "grant" arrives after the cancel
    const m = await media(page);
    expect(m.gumCalls).toBe(1);
    expect(m.recorderStarts).toBe(0);
    expect(m.liveTracks).toBe(0);
    await expect(page.getByRole("button", { name: /Hold to talk/ })).toBeVisible();
  });

  test("leaving the page while the permission prompt is pending: the mic is released", async ({ page }) => {
    await page.evaluate(() => (window.__gumDelayMs = 1_500));
    await mic(page).click();
    await expect(page.getByText("Allow microphone access to talk…")).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForTimeout(2_500);
    const m = await media(page);
    expect(m.recorderStarts).toBe(0);
    expect(m.liveTracks).toBe(0);
  });

  test("cancel during transcription aborts the upload and leaves the draft untouched", async ({ page }) => {
    await page.route("**/api/voice/transcriptions", async (route) => {
      await new Promise((r) => setTimeout(r, 4_000)); // slow provider
      await route.continue().catch(() => undefined); // the browser has aborted by now
    });
    const failed = page.waitForEvent("requestfailed", (r) => r.url().includes("/api/voice/transcriptions"));
    await record(page, 1_500);
    await expect(page.getByText("Transcribing…")).toBeVisible();
    await page.getByRole("button", { name: "Cancel transcription" }).click();
    await failed;
    await page.waitForTimeout(500);
    await expect(composer(page)).toHaveValue("");
    await expect(appAlert(page)).toHaveCount(0);
  });

  test("a provider error is explained and the draft is untouched", async ({ page }) => {
    await page.route("**/api/voice/transcriptions", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "Voice is busy right now. Try again in a moment, or type instead.", retryable: true } }),
      }),
    );
    await record(page, 1_500);
    await expect(appAlert(page)).toContainText("Voice is busy right now");
    await expect(composer(page)).toHaveValue("");
  });
});

test.describe("Tamil via fake microphone (ta.wav) @ta", () => {
  test("Tamil speech → Tamil transcript → answer → spoken", async ({ page }) => {
    await instrument(page);
    await page.goto("/assistant");
    await record(page, 5_300); // ta.wav is 4.7 s
    await expect(composer(page)).toHaveValue(/வணக்கம்/, { timeout: 30_000 });
    await expect(page.getByText(/From voice \(Tamil\)/)).toBeVisible();
    const transcript = await composer(page).inputValue();
    const spoken = await sendAndAwaitSpokenAnswer(page);
    test.info().annotations.push({ type: "transcript", description: transcript }, { type: "spoken", description: spoken.text.slice(0, 160) });
  });
});

test.describe("Silence via fake microphone (silence.wav) @silence", () => {
  test("silence → a clear 'couldn't hear' message, nothing in the draft", async ({ page }) => {
    await instrument(page);
    await page.goto("/assistant");
    await record(page, 2_000);
    await expect(appAlert(page)).toContainText("couldn't hear any speech", { timeout: 30_000 });
    await expect(composer(page)).toHaveValue("");
  });
});

test.describe("Without a microphone grant @nomic", () => {
  test("permission denied → explained, nothing recorded", async ({ page }) => {
    await instrument(page);
    await page.addInitScript(() => (window.__gumMode = "deny"));
    await page.goto("/assistant");
    await mic(page).click();
    await expect(appAlert(page)).toContainText("Microphone access is blocked");
    expect((await media(page)).recorderStarts).toBe(0);
  });

  test("speech playback: Stop works, leaving the page stops it, and TTS failure falls back", async ({ page }) => {
    await instrument(page);
    await page.goto("/assistant");
    await composer(page).fill("Say hello to me in one short sentence.");
    await composer(page).press("Enter");
    const readAloud = page.getByRole("button", { name: "Read this answer aloud" }).last();
    await expect(readAloud).toBeVisible({ timeout: 120_000 });

    await readAloud.click();
    await expect.poll(async () => (await media(page)).plays).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Stop speaking" }).click();
    expect((await media(page)).pauses).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "Stop speaking" })).toHaveCount(0);

    const before = (await media(page)).pauses;
    await readAloud.click();
    await expect.poll(async () => (await media(page)).plays).toBeGreaterThan(1);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect.poll(async () => (await media(page)).pauses).toBeGreaterThan(before); // unmount stopped it

    await page.goBack();
    const warnings: string[] = [];
    page.on("console", (m) => m.type() === "warning" && warnings.push(m.text()));
    await page.route("**/api/voice/speech", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":{"code":"VOICE_UNAVAILABLE","message":"x"}}' }));
    await page.getByRole("button", { name: "Read this answer aloud" }).last().click();
    await expect.poll(() => warnings.some((w) => w.includes("neural speech failed, using browser voice"))).toBe(true);
  });
});

test.describe("Session and delivery recovery (review findings) @nomic", () => {
  test.describe("with no saved session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test("a stale session cookie lands on /login without a redirect loop, and login works", async ({ page, context }) => {
    await context.addCookies([{ name: "pos_session", value: "x".repeat(43), url: ORIGIN }]);
    const navigations: string[] = [];
    page.on("framenavigated", (f) => f === page.mainFrame() && navigations.push(f.url()));
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.waitForTimeout(2_000);
    expect(navigations.length).toBeLessThan(5); // no ping-pong between / and /login
    expect((await context.cookies()).some((c) => c.name === "pos_session")).toBe(false); // API cleared it
    await page.getByLabel("Email").fill(OWNER.email);
    await page.getByLabel("Password").fill(OWNER.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/(welcome)?$/); // first sign-in on a device shows the welcome
    });
  });

  test("a lost HTTP response on send: resending does not run the message twice", async ({ page }) => {
    await page.goto("/assistant");
    let first = true;
    await page.route("**/api/conversations/*/messages", async (route) => {
      if (route.request().method() !== "POST" || !first) return route.fallback();
      first = false;
      await route.fetch(); // the server receives and accepts it...
      await route.abort("connectionreset"); // ...but the browser never sees the response
    });
    const text = `Reply with the single word "pong". (${Date.now()})`;
    await composer(page).fill(text);
    await composer(page).press("Enter");
    await expect(appAlert(page)).toContainText("Press Send again");
    await expect(composer(page)).toHaveValue(text);
    const resend = page.waitForResponse((r) => r.url().includes("/messages") && r.request().method() === "POST");
    await composer(page).press("Enter");
    expect(await (await resend).json()).toMatchObject({ deduplicated: true });
    await expect(page.getByRole("button", { name: "Read this answer aloud" }).last()).toBeVisible({ timeout: 120_000 });
    const conversationId = new URL(page.url()).searchParams.get("c");
    const history = (await (await page.context().request.get(`/api/conversations/${conversationId}/messages`)).json()) as { items: { role: string; text: string }[] };
    expect(history.items.filter((m) => m.role === "user" && m.text === text)).toHaveLength(1);
  });
});
