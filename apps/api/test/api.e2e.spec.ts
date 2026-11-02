import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TaskEvent } from "@personalos/contracts";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { TEST_DATABASE_URL } from "./global-setup.js";
import { FakeGateway } from "./helpers/fake-gateway.js";
import { resetTestDatabase } from "./helpers/reset-db.js";

const ORIGIN = "http://localhost:3000";
Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: TEST_DATABASE_URL,
  WEB_ORIGIN: ORIGIN,
  COOKIE_SECURE: "false",
  OPENCLAW_GATEWAY_URL: "ws://127.0.0.1:1",
  OPENCLAW_DEVICE_DIR: "/tmp/unused",
});

// Imported after env is set (env is read when the module graph is built).
const { AppModule } = await import("../src/app.module.js");
const { configureApp } = await import("../src/app.factory.js");
const { AgentGateway } = await import("../src/gateway/gateway.port.js");
const { PrismaService } = await import("../src/prisma/prisma.service.js");
const { hashPassword } = await import("../src/auth/crypto.js");
const { TasksService } = await import("../src/tasks/tasks.service.js");

type SseEvent = { id: string | undefined; event: string | undefined; data: TaskEvent };
function parseSse(body: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of body.split("\n\n")) {
    const fields: Record<string, string> = {};
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      fields[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    if (fields.data) out.push({ id: fields.id, event: fields.event, data: JSON.parse(fields.data) as TaskEvent });
  }
  return out;
}

/** Collects an SSE body as text (the stream ends after the terminal task.status). */
const readText = (test: request.Test) =>
  test.buffer(true).parse(((res: NodeJS.ReadableStream, cb: (err: Error | null, body: string) => void) => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => (data += c));
    res.on("end", () => cb(null, data));
  }) as unknown as Parameters<request.Test["parse"]>[0]);

describe("PersonalOS API (real HTTP pipeline + Postgres, fake gateway)", () => {
  let app: INestApplication;
  let gateway: FakeGateway;
  let prisma: InstanceType<typeof PrismaService>;
  let cookie: string;
  const http = () => request(app.getHttpServer());
  const post = (url: string) => http().post(url).set("Origin", ORIGIN).set("Cookie", cookie);
  const get = (url: string) => http().get(url).set("Cookie", cookie);
  const streamTask = async (taskId: string) => parseSse((await readText(get(`/api/tasks/${taskId}/events`))).body as string);
  const newConversation = async () => (await post("/api/conversations").send({})).body.id as string;
  const send = (conversationId: string, text = "hi", clientRequestId = randomUUID()) =>
    post(`/api/conversations/${conversationId}/messages`).send({ clientRequestId, text });

  beforeAll(async () => {
    gateway = new FakeGateway();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AgentGateway).useValue(gateway).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
    await prisma.user.create({ data: { email: "owner@example.com", displayName: "Owner", passwordHash: await hashPassword("correct horse battery"), preference: { create: {} } } });
    // Every test can run in isolation (vitest -t): log in here rather than relying on test order.
    const login = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "owner@example.com", password: "correct horse battery" });
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    gateway.script = FakeGateway.answer("Hello from the fake runtime.");
    gateway.state$.next("connected");
  });

  describe("auth", () => {
    it("health is public; everything else needs a session", async () => {
      expect((await http().get("/api/health")).body).toMatchObject({ db: "ok", gateway: "connected" });
      const res = await http().get("/api/conversations");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    });

    it("rejects bad credentials without revealing which part was wrong", async () => {
      const a = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "owner@example.com", password: "wrong" });
      const b = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "nobody@example.com", password: "wrong" });
      expect([a.status, b.status]).toEqual([401, 401]);
      expect(a.body).toEqual(b.body);
    });

    it("rejects state-changing requests from another origin (CSRF)", async () => {
      const res = await http().post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "owner@example.com", password: "correct horse battery" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN_ORIGIN");
    });

    it("accepts the loopback aliases of a localhost WEB_ORIGIN, and nothing else (login via http://127.0.0.1:3000)", async () => {
      // Origin is checked before authentication (and this route has no login rate limit): 401 = origin accepted.
      const login = (origin: string) => http().post("/api/conversations").set("Origin", origin).send({});
      for (const origin of ["http://127.0.0.1:3000", "http://[::1]:3000"]) expect((await login(origin)).status).toBe(401);
      for (const origin of ["http://127.0.0.1:3001", "https://127.0.0.1:3000", "http://localhost.evil.example:3000", "http://192.168.1.5:3000"]) {
        expect((await login(origin)).status).toBe(403);
      }
    });

    it("clears a stale session cookie on 401 so the login page can recover (review finding)", async () => {
      const res = await http().get("/api/auth/me").set("Cookie", "pos_session=" + "x".repeat(43));
      expect(res.status).toBe(401);
      expect(String(res.headers["set-cookie"])).toMatch(/pos_session=;.*Expires=Thu, 01 Jan 1970/);
      const none = await http().get("/api/auth/me");
      expect(none.headers["set-cookie"]).toBeUndefined(); // no cookie, nothing to clear
    });

    it("logs in with an httpOnly SameSite=Lax session cookie", async () => {
      const res = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "Owner@Example.com", password: "correct horse battery" });
      expect(res.status).toBe(204);
      const setCookie = String(res.headers["set-cookie"]);
      expect(setCookie).toMatch(/pos_session=/);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      cookie = setCookie.split(";")[0]!;
      const stored = await prisma.authSession.findFirstOrThrow();
      expect(cookie).not.toContain(stored.tokenHash); // only the hash is stored
      expect((await get("/api/auth/me")).body.email).toBe("owner@example.com");
    });
  });

  describe("chat workflow", () => {
    it("streams real runtime progress, tools, text and completion over SSE", async () => {
      const conversationId = await newConversation();
      const res = await send(conversationId, "What's on example.com?");
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ status: "RUNNING", deduplicated: false });

      const events = await streamTask(res.body.taskId);
      const types = events.map((e) => e.data.type);
      expect(types[0]).toBe("task.status");
      expect(types).toEqual(expect.arrayContaining(["task.progress", "tool.started", "tool.finished", "assistant.text", "assistant.final"]));
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "SUCCEEDED" });
      expect(events.find((e) => e.data.type === "tool.started")?.data).toMatchObject({ tool: "web_fetch", label: "Web Fetch from https://example.com" });
      // F5: the empty replace before final is not forwarded as a blank answer.
      expect(events.filter((e) => e.data.type === "assistant.text").every((e) => (e.data as { text: string }).text !== "")).toBe(true);
      expect(events.find((e) => e.data.type === "assistant.final")?.data).toEqual({ type: "assistant.final", text: "Hello from the fake runtime." });

      const task = await prisma.appTask.findUniqueOrThrow({ where: { id: res.body.taskId } });
      expect(task).toMatchObject({ status: "SUCCEEDED", openClawRunId: task.id, runIds: [task.id] });
      const conv = await prisma.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(conv.title).toBe("What's on example.com?");
      expect(gateway.sent.at(-1)).toMatchObject({ sessionKey: `agent:personalos:conv:${conversationId}`, idempotencyKey: task.id });
    });

    it("two conversations starting with the same words both work (OpenClaw labels must be unique)", async () => {
      const a = await send(await newConversation(), "Good morning. What is on my schedule today?");
      const b = await send(await newConversation(), "Good morning. What is on my schedule today?");
      expect([a.status, b.status]).toEqual([202, 202]);
      expect((await streamTask(b.body.taskId)).at(-1)?.data).toEqual({ type: "task.status", status: "SUCCEEDED" });
    });

    it("resumes an SSE stream from Last-Event-ID without replaying seen events", async () => {
      const conversationId = await newConversation();
      const { taskId } = (await send(conversationId)).body;
      const all = await streamTask(taskId);
      const resumed = parseSse((await readText(get(`/api/tasks/${taskId}/events`).set("Last-Event-ID", all[2]!.id!))).body as string);
      expect(resumed.length).toBeGreaterThan(0);
      expect(resumed.every((e) => Number(e.id) > Number(all[2]!.id))).toBe(true);
    });

    it("treats a resubmitted clientRequestId as the same task (idempotent)", async () => {
      const conversationId = await newConversation();
      const clientRequestId = randomUUID();
      const first = await send(conversationId, "once", clientRequestId);
      await streamTask(first.body.taskId);
      const again = await send(conversationId, "once", clientRequestId);
      expect(again.status).toBe(202);
      expect(again.body).toMatchObject({ taskId: first.body.taskId, deduplicated: true, status: "SUCCEEDED" });
      expect(gateway.sent.filter((s) => s.message === "once")).toHaveLength(1);
    });

    it("rejects an overlapping message with 409, then cancels the running task", async () => {
      gateway.script = FakeGateway.hang();
      const conversationId = await newConversation();
      const first = await send(conversationId, "long job");
      const second = await send(conversationId, "impatient");
      expect(second.status).toBe(409);
      expect(second.body.error).toMatchObject({ code: "TASK_IN_PROGRESS", details: { taskId: first.body.taskId } });

      const cancel = await post(`/api/tasks/${first.body.taskId}/cancel`).send();
      expect(cancel.status).toBe(202);
      const events = await streamTask(first.body.taskId);
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "CANCELLED" });
      expect(gateway.aborted.at(-1)).toMatchObject({ runId: first.body.taskId });
      expect((await send(conversationId, "now it's free")).status).toBe(202);
    });

    it("serialises concurrent submits: exactly one wins, the other gets 409", async () => {
      gateway.script = FakeGateway.hang();
      const conversationId = await newConversation();
      const results = await Promise.all([send(conversationId, "a"), send(conversationId, "b"), send(conversationId, "c")]);
      expect(results.map((r) => r.status).sort()).toEqual([202, 409, 409]);
      const winner = results.find((r) => r.status === 202)!;
      await post(`/api/tasks/${winner.body.taskId}/cancel`).send();
    });

    it("returns 503 without creating a task when the runtime is unavailable", async () => {
      const conversationId = await newConversation();
      gateway.state$.next("reconnecting");
      const res = await send(conversationId);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "GATEWAY_UNAVAILABLE", retryable: true });
      expect(await prisma.appTask.count({ where: { conversationId } })).toBe(0);
    });

    it("maps a runtime timeout to TIMED_OUT with a user-safe message", async () => {
      gateway.script = ({ runId, sessionKey, emit }) =>
        emit({ kind: "terminal", runId, sessionKey, state: "error", text: "", errorKind: "timeout", stopReason: null });
      const { taskId } = (await send(await newConversation())).body;
      const events = await streamTask(taskId);
      expect(events.find((e) => e.data.type === "task.error")?.data).toMatchObject({ code: "RUN_TIMEOUT", retryable: true });
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "TIMED_OUT" });
    });
  });

  describe("delivery uncertainty (review finding: lost send acknowledgment)", () => {
    it("does not fail a task whose chat.send reply was lost; the run's real outcome wins", async () => {
      gateway.sendFailure = "ack-lost"; // run starts in the runtime, reply never arrives
      const conversationId = await newConversation();
      const res = await send(conversationId, "survive a lost ack");
      expect(res.status).toBe(202);
      expect(res.body).toMatchObject({ status: "QUEUED", deduplicated: false });
      const events = await streamTask(res.body.taskId);
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "SUCCEEDED" });
      expect(events.map((e) => e.data)).toContainEqual({ type: "assistant.final", text: "Hello from the fake runtime." });
    });

    it("settles an ack-lost task as INTERRUPTED when the runtime never ran it", async () => {
      gateway.sendFailure = "ack-lost";
      gateway.script = () => undefined; // nothing actually ran
      const conversationId = await newConversation();
      const { taskId } = (await send(conversationId, "lost for real")).body;
      gateway.waitResult = { status: "timeout", stopReason: null, error: null };
      await app.get(TasksService).reconcileById(taskId, "test");
      const task = await prisma.appTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(task).toMatchObject({ status: "FAILED", errorCode: "INTERRUPTED" });
    });

    it("fails fast (503) only when the message definitely never left the API", async () => {
      gateway.sendFailure = "not-sent";
      const conversationId = await newConversation();
      const res = await send(conversationId, "never sent");
      expect(res.status).toBe(503);
      const task = await prisma.appTask.findFirstOrThrow({ where: { conversationId } });
      expect(task).toMatchObject({ status: "FAILED", errorCode: "GATEWAY_SEND_FAILED" });
    });

    it("a resend with the same clientRequestId after a lost HTTP response returns the same task", async () => {
      const conversationId = await newConversation();
      const clientRequestId = randomUUID();
      const first = await send(conversationId, "network blip", clientRequestId);
      const again = await send(conversationId, "network blip", clientRequestId); // browser never saw `first`
      expect(again.body).toMatchObject({ taskId: first.body.taskId, deduplicated: true });
      await streamTask(first.body.taskId);
      expect(await prisma.appTask.count({ where: { conversationId } })).toBe(1);
    });
  });

  describe("restart reconciliation (spike F4)", () => {
    it("adopts a recovery run that appears under a new runId in the same session", async () => {
      gateway.script = FakeGateway.hang();
      const conversationId = await newConversation();
      const { taskId } = (await send(conversationId, "survive a restart")).body;
      const sessionKey = `agent:personalos:conv:${conversationId}`;

      // Gateway restarts: the original run vanishes, OpenClaw resumes under a new runId.
      // Both discovery paths fire, as observed live: reconnect reconciliation AND the first event.
      const recoveryRunId = randomUUID();
      gateway.historyBySession.set(sessionKey, { exists: true, messages: [], inFlightRunId: recoveryRunId, hasActiveRun: true, activeRunIds: null });
      const reconciling = app.get(TasksService).reconcileAll("test reconnect");
      gateway.emit({ kind: "lifecycle-start", runId: recoveryRunId, sessionKey });
      await reconciling;
      gateway.emit({ kind: "delta", runId: recoveryRunId, sessionKey, payload: { deltaText: "Recovered", message: { role: "assistant", content: [{ type: "text", text: "Recovered" }] } } });
      gateway.emit({ kind: "terminal", runId: recoveryRunId, sessionKey, state: "final", text: "Recovered answer", errorKind: null, stopReason: "stop" });

      const events = await streamTask(taskId);
      expect(events.map((e) => e.data)).toEqual(expect.arrayContaining([{ type: "task.progress", phase: "resumed" }, { type: "assistant.final", text: "Recovered answer" }]));
      expect(events.filter((e) => e.data.type === "task.progress" && e.data.phase === "resumed")).toHaveLength(1);
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "SUCCEEDED" });
      const task = await prisma.appTask.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.runIds).toEqual([taskId, recoveryRunId]);
    });

    it("settles a task that finished while the gateway connection was down", async () => {
      gateway.script = FakeGateway.hang();
      const conversationId = await newConversation();
      const { taskId } = (await send(conversationId, "finish while I'm away")).body;
      const task = await prisma.appTask.findUniqueOrThrow({ where: { id: taskId } });

      // On reconnect the session is idle, agent.wait no longer knows the run, the transcript has the answer.
      gateway.historyBySession.set(`agent:personalos:conv:${conversationId}`, {
        exists: true,
        inFlightRunId: null,
        hasActiveRun: false,
        activeRunIds: [],
        messages: [
          { id: "u", role: "user", text: "finish while I'm away", timestamp: task.createdAt.getTime() + 10, runId: null, internal: false },
          { id: "a", role: "assistant", text: "Done while disconnected", timestamp: task.createdAt.getTime() + 2000, runId: null, internal: false },
        ],
      });
      gateway.waitResult = { status: "timeout", stopReason: null, error: null };
      await app.get(TasksService).reconcileAll("test reconnect");

      expect((await prisma.appTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("SUCCEEDED");
      const events = await streamTask(taskId);
      expect(events.map((e) => e.data)).toContainEqual({ type: "assistant.final", text: "Done while disconnected" });
    });
  });

  describe("ownership and validation", () => {
    it("hides other users' conversations and tasks (404, not 403)", async () => {
      const other = await prisma.user.create({ data: { email: "other@example.com", displayName: "Other", passwordHash: "x" } });
      const foreign = await prisma.conversation.create({ data: { id: randomUUID(), userId: other.id, openClawSessionKey: `agent:personalos:conv:${randomUUID()}` } });
      expect((await get(`/api/conversations/${foreign.id}/messages`)).status).toBe(404);
      expect((await send(foreign.id)).status).toBe(404);
      expect((await get(`/api/tasks/${randomUUID()}`)).status).toBe(404);
    });

    it("validates bodies against the shared contracts", async () => {
      const conversationId = await newConversation();
      const res = await post(`/api/conversations/${conversationId}/messages`).send({ clientRequestId: "not-a-uuid", text: "" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("VALIDATION_FAILED");
      const details = (res.body as { error: { details: Array<{ path: string }> } }).error.details;
      expect(details.map((d) => d.path).sort()).toEqual(["clientRequestId", "text"]);
    });
  });
});
