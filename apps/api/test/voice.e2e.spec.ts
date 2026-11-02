import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./global-setup.js";
import { FakeGateway } from "./helpers/fake-gateway.js";
import { resetTestDatabase } from "./helpers/reset-db.js";
import { FakeStt, FakeTts } from "./helpers/fake-voice.js";

const ORIGIN = "http://localhost:3000";
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  WEB_ORIGIN: ORIGIN,
  COOKIE_SECURE: "false",
  OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:1",
  OPENCLAW_DEVICE_DIR: "/tmp/unused",
});

const { AppModule } = await import("../src/app.module.js");
const { configureApp } = await import("../src/app.factory.js");
const { AgentGateway } = await import("../src/gateway/gateway.port.js");
const { PrismaService } = await import("../src/prisma/prisma.service.js");
const { hashPassword } = await import("../src/auth/crypto.js");
const { STT_PROVIDERS, TTS_PROVIDERS, VoiceProviderError } = await import("../src/voice/providers/types.js");

describe("Voice API (real HTTP pipeline + Postgres, fake providers)", () => {
  let app: INestApplication;
  let cookie: string;
  const stt = new FakeStt();
  const tts = new FakeTts();
  const http = () => request(app.getHttpServer());
  const upload = (bytes: Buffer, mime = "audio/webm;codecs=opus", fields: Record<string, string> = {}) => {
    const req = http().post("/api/voice/transcriptions").set("Origin", ORIGIN).set("Cookie", cookie);
    for (const [k, v] of Object.entries(fields)) void req.field(k, v);
    return req.attach("audio", bytes, { filename: "rec.webm", contentType: mime });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AgentGateway)
      .useValue(new FakeGateway())
      .overrideProvider(STT_PROVIDERS)
      .useValue([stt])
      .overrideProvider(TTS_PROVIDERS)
      .useValue([tts])
      .compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    const prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
    await prisma.user.create({ data: { email: "owner@example.com", displayName: "Owner", passwordHash: await hashPassword("correct horse battery") } });
    const login = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "owner@example.com", password: "correct horse battery" });
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    stt.calls = [];
    tts.calls = [];
    stt.next = { text: "what is on my schedule today", locale: "en-IN", confidence: 0.93, durationMs: 2100 };
  });

  it("health reports voice availability", async () => {
    expect((await http().get("/api/health")).body).toMatchObject({ voice: "ok" });
  });

  describe("transcription", () => {
    it("transcribes a browser recording with candidate locales (auto) and keeps the call alive", async () => {
      const res = await upload(Buffer.alloc(4000, 1));
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ text: "what is on my schedule today", locale: "en-IN", confidence: 0.93, durationMs: 2100 });
      // Regression: the provider call must not be aborted by a healthy client (request "close" fires after body read).
      expect(stt.calls[0]).toEqual({ mimeType: "audio/webm", locales: ["en-IN", "ta-IN"], bytes: 4000, abortedDuringCall: false });
    });

    it("cancels the provider call when the browser aborts mid-transcription", async () => {
      stt.delayMs = 400;
      const aborted = upload(Buffer.alloc(100, 1)).timeout(100); // client gives up after 100 ms
      await expect(aborted).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 450));
      expect(stt.calls.at(-1)?.abortedDuringCall).toBe(true);
      stt.delayMs = 30;
    });

    it("honours an explicit language", async () => {
      await upload(Buffer.alloc(100, 1), "audio/webm", { language: "ta-IN" });
      expect(stt.calls[0]?.locales).toEqual(["ta-IN"]);
    });

    it("rejects unsupported formats (415), oversized audio (413), and bad languages (400)", async () => {
      const a = await upload(Buffer.alloc(100, 1), "video/mp4");
      expect([a.status, a.body.error.code]).toEqual([415, "UNSUPPORTED_AUDIO"]);
      const b = await upload(Buffer.alloc(2 * 1024 * 1024 + 1, 1));
      expect([b.status, b.body.error.code]).toEqual([413, "AUDIO_TOO_LARGE"]);
      const c = await upload(Buffer.alloc(100, 1), "audio/webm", { language: "fr-FR" });
      expect([c.status, c.body.error.code]).toEqual([400, "VALIDATION_FAILED"]);
      expect(stt.calls).toHaveLength(0);
    });

    it("returns NO_SPEECH (422) for silence", async () => {
      stt.next = { text: "", locale: null, confidence: null, durationMs: 1500 };
      const res = await upload(Buffer.alloc(100, 1));
      expect([res.status, res.body.error.code]).toEqual([422, "NO_SPEECH"]);
    });

    it("maps provider throttling to a retryable 429 without leaking provider details", async () => {
      stt.next = new VoiceProviderError("rate_limited", "azure", "F0 tier exceeded call rate limit");
      const res = await upload(Buffer.alloc(100, 1));
      expect(res.status).toBe(429);
      expect(res.body.error).toMatchObject({ code: "RATE_LIMITED", retryable: true });
      expect(JSON.stringify(res.body)).not.toContain("F0");
    });

    it("requires a session and a same-origin request", async () => {
      const noAuth = await http().post("/api/voice/transcriptions").set("Origin", ORIGIN).attach("audio", Buffer.alloc(10), "a.webm");
      expect(noAuth.status).toBe(401);
      const crossSite = await http().post("/api/voice/transcriptions").set("Origin", "https://evil.example").set("Cookie", cookie).attach("audio", Buffer.alloc(10), "a.webm");
      expect(crossSite.status).toBe(403);
    });

    it("audits metadata only: never the transcript text", async () => {
      await upload(Buffer.alloc(100, 1));
      const prisma = app.get(PrismaService);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "voice.transcribed" }, orderBy: { createdAt: "desc" } });
      expect(row.metadata).toMatchObject({ provider: "azure", bytes: 100, locale: "en-IN" });
      expect(JSON.stringify(row.metadata)).not.toContain("schedule");
    });
  });

  describe("speech", () => {
    const speak = (body: unknown) => http().post("/api/voice/speech").set("Origin", ORIGIN).set("Cookie", cookie).send(body as object);

    it("streams audio, speaking clean text with the voice for the text's language", async () => {
      const res = await speak({ text: "## Plan\n- **Standup** at 10" }).buffer(true);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("audio/mpeg");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(tts.calls[0]).toMatchObject({ text: "Plan. Standup at 10.", locale: "en-IN", voice: "en-IN-NeerjaNeural", rate: 1 });

      await speak({ text: "இன்று உங்களுக்கு இரண்டு கூட்டங்கள் உள்ளன." });
      expect(tts.calls[1]).toMatchObject({ locale: "ta-IN", voice: "ta-IN-PallaviNeural" });
    });

    it("validates length", async () => {
      expect((await speak({ text: "" })).status).toBe(400);
      expect((await speak({ text: "x".repeat(2001) })).status).toBe(400);
    });
  });

  describe("preferences", () => {
    it("returns defaults, then persists validated updates that change speech", async () => {
      const initial = await http().get("/api/voice/settings").set("Cookie", cookie);
      expect(initial.body).toMatchObject({ available: true, preferences: { language: "auto", voiceEn: "en-IN-NeerjaNeural", autoSpeak: true } });

      const upd = await http().put("/api/voice/preferences").set("Origin", ORIGIN).set("Cookie", cookie).send({ voiceEn: "en-IN-PrabhatNeural", speechRate: 1.2, language: "en-IN" });
      expect(upd.status).toBe(200);
      await http().post("/api/voice/speech").set("Origin", ORIGIN).set("Cookie", cookie).send({ text: "Hello" });
      expect(tts.calls.at(-1)).toMatchObject({ voice: "en-IN-PrabhatNeural", rate: 1.2 });
      await upload(Buffer.alloc(10, 1));
      expect(stt.calls.at(-1)?.locales).toEqual(["en-IN"]);
    });

    it("rejects voices that don't exist or don't match the language", async () => {
      const put = (body: object) => http().put("/api/voice/preferences").set("Origin", ORIGIN).set("Cookie", cookie).send(body);
      expect((await put({ voiceEn: "ta-IN-PallaviNeural" })).status).toBe(400);
      expect((await put({ voiceTa: "<evil/>" })).status).toBe(400);
      expect((await put({ speechRate: 5 })).status).toBe(400);
    });
  });
});
