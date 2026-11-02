import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { DemoAction, DemoWorkspace, TaskEvent } from "@personalos/contracts";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  // A fully configured integration: proves the demo doesn't use it even when it could.
  CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  MS_TENANT_ID: "contoso-tenant",
  MS_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
  MS_CLIENT_SECRET: "test-client-secret",
  MS_REDIRECT_URI: `${ORIGIN}/api/integrations/microsoft-calendar/callback`,
});

const { AppModule } = await import("../src/app.module.js");
const { configureApp } = await import("../src/app.factory.js");
const { AgentGateway } = await import("../src/gateway/gateway.port.js");
const { PrismaService } = await import("../src/prisma/prisma.service.js");
const { hashPassword } = await import("../src/auth/crypto.js");
const { DemoService } = await import("../src/demo/demo.service.js");

type SseEvent = { id: string | undefined; data: TaskEvent };
function parseSse(body: string): SseEvent[] {
  const out: SseEvent[] = [];
  for (const block of body.split("\n\n")) {
    const fields: Record<string, string> = {};
    for (const line of block.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      fields[line.slice(0, i)] = line.slice(i + 1).trim();
    }
    if (fields.data) out.push({ id: fields.id, data: JSON.parse(fields.data) as TaskEvent });
  }
  return out;
}
const readText = (test: request.Test) =>
  test.buffer(true).parse(((res: NodeJS.ReadableStream, cb: (err: Error | null, body: string) => void) => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", (c: string) => (data += c));
    res.on("end", () => cb(null, data));
  }) as unknown as Parameters<request.Test["parse"]>[0]);

describe("Demo workspace: sample data, simulated actions, isolated from real services", () => {
  let app: INestApplication;
  let gateway: FakeGateway;
  let prisma: InstanceType<typeof PrismaService>;
  let cookie: string;
  /** Any outbound HTTP from the API process during a demo request is a failure. */
  const fetchSpy = vi.fn(async () => {
    throw new Error("demo must not make network calls");
  });
  const http = () => request(app.getHttpServer());
  const get = (url: string) => http().get(url).set("Cookie", cookie);
  const post = (url: string, body?: object) => http().post(url).set("Origin", ORIGIN).set("Cookie", cookie).send(body ?? {});
  const workspace = async () => (await get("/api/demo/workspace")).body as DemoWorkspace;
  const turn = async (text: string) => {
    const res = await post("/api/demo/turns", { clientRequestId: crypto.randomUUID(), text });
    expect(res.status).toBe(202);
    return { turnId: res.body.turnId as string, events: parseSse((await readText(get(`/api/demo/turns/${res.body.turnId}/events`))).body as string) };
  };

  beforeAll(async () => {
    gateway = new FakeGateway();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AgentGateway).useValue(gateway).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    app.get(DemoService).timeScale = 0.01; // a scripted turn takes ~30 ms instead of ~3 s
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
    await prisma.user.create({ data: { email: "owner@example.com", displayName: "Owner", passwordHash: await hashPassword("correct horse battery") } });
    const login = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "owner@example.com", password: "correct horse battery" });
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });

  beforeEach(async () => {
    await post("/api/demo/reset");
  });

  it("requires a signed-in session and a same-origin request", async () => {
    expect((await http().get("/api/demo/workspace")).status).toBe(401);
    expect((await http().post("/api/demo/actions/lunch-team/approve").set("Cookie", cookie)).status).toBe(403);
  });

  it("serves a sample workspace that is marked simulated end to end", async () => {
    const res = await get("/api/demo/workspace");
    expect(res.headers["x-personalos-demo"]).toBe("simulated");
    const ws = res.body as DemoWorkspace;
    expect(ws.simulated).toBe(true);
    expect(ws.business.name).toMatch(/\(sample\)/);
    expect(ws.actions.every((a) => a.simulated === true)).toBe(true);
    expect(ws.services.every((s) => s.status === "simulated")).toBe(true);
    expect(ws.actions.map((a) => a.status)).toEqual(["proposed", "proposed", "proposed", "failed", "completed"]);
    const lunch = ws.actions.find((a) => a.id === "lunch-team")!;
    expect(lunch.order).toMatchObject({ subtotal: 1640, taxes: 82, deliveryFee: 40, total: 1762, currency: "INR" });
  });

  it("streams a scripted turn as ordinary task events, with tool steps and sources", async () => {
    const { events } = await turn("Give me my morning briefing");
    const types = events.map((e) => e.data.type);
    expect(types[0]).toBe("task.status");
    expect(events.filter((e) => e.data.type === "tool.started").map((e) => (e.data as { label: string }).label)).toEqual([
      "Reading sample calendar",
      "Checking sample CRM",
      "Reviewing sample payments",
    ]);
    expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "SUCCEEDED" });
    const final = events.find((e) => e.data.type === "assistant.final")!.data as { text: string };
    expect(final.text).toMatch(/Site visit: Velachery 3BHK/);

    const ws = await workspace();
    expect(ws.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(ws.messages[1]!.sources.map((s) => s.label)).toContain("Sample calendar");
  });

  it("resumes a turn stream from Last-Event-ID", async () => {
    const { turnId, events } = await turn("Which payments are due?");
    const resumed = parseSse((await readText(get(`/api/demo/turns/${turnId}/events`).set("Last-Event-ID", events[2]!.id!))).body as string);
    expect(resumed.map((e) => e.id)).toEqual(events.slice(3).map((e) => e.id));
  });

  it("answers the lunch request with an approval card instead of acting", async () => {
    const { events } = await turn("Order lunch for the team");
    expect((events.find((e) => e.data.type === "assistant.final")!.data as { text: string }).text).toMatch(/Total: ₹1,762/);
    const ws = await workspace();
    expect(ws.messages.at(-1)!.actionIds).toEqual(["lunch-team"]);
    expect(ws.actions.find((a) => a.id === "lunch-team")!.status).toBe("proposed"); // nothing happened yet
  });

  it("approving the lunch order completes a simulated order: 'No real order placed.'", async () => {
    // A client cannot steer the outcome: extra fields (recipient, amount) are ignored.
    const res = await post("/api/demo/actions/lunch-team/approve", { total: 1, recipient: "+919999999999" });
    expect(res.status).toBe(200);
    expect(res.headers["x-personalos-demo"]).toBe("simulated");
    const action = res.body as DemoAction;
    expect(action).toMatchObject({ status: "completed", simulated: true, resultNote: "No real order placed." });
    expect(action.order!.total).toBe(1762);
    expect(action.timeline.map((t) => t.status)).toEqual(["proposed", "approved", "completed"]);
    expect(action.timeline.at(-1)!.note).toBe("Simulated · No real order placed.");

    const again = await post("/api/demo/actions/lunch-team/approve");
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ACTION_NOT_PENDING");
  });

  it("approving a follow-up simulates it ('No real message sent.'); declining sends nothing", async () => {
    expect((await post("/api/demo/actions/msg-divya/approve")).body).toMatchObject({ status: "completed", resultNote: "No real message sent." });
    expect((await post("/api/demo/actions/msg-karthik/reject")).body).toMatchObject({ status: "rejected", resultNote: "Declined. No real message sent." });
    expect((await post("/api/demo/actions/msg-suresh/approve")).status).toBe(409); // failed actions stay failed
    expect((await post("/api/demo/actions/not-a-sample/approve")).status).toBe(404);
    expect((await post("/api/demo/actions/..%2Fintegrations/approve")).status).toBe(404);
  });

  it("one turn at a time, idempotent per clientRequestId, and Stop cancels without an answer", async () => {
    app.get(DemoService).timeScale = 1;
    try {
      const clientRequestId = crypto.randomUUID();
      const first = await post("/api/demo/turns", { clientRequestId, text: "Give me my morning briefing" });
      expect((await post("/api/demo/turns", { clientRequestId, text: "Give me my morning briefing" })).body).toEqual({ turnId: first.body.turnId, deduplicated: true });
      const busy = await post("/api/demo/turns", { clientRequestId: crypto.randomUUID(), text: "hello" });
      expect(busy.status).toBe(409);
      expect(busy.body.error).toMatchObject({ code: "TASK_IN_PROGRESS", details: { taskId: first.body.turnId } });

      expect((await post(`/api/demo/turns/${first.body.turnId}/cancel`)).body).toMatchObject({ status: "cancelled" });
      const events = parseSse((await readText(get(`/api/demo/turns/${first.body.turnId}/events`))).body as string);
      expect(events.at(-1)?.data).toEqual({ type: "task.status", status: "CANCELLED" });
      expect((await workspace()).messages.map((m) => m.role)).toEqual(["user"]);
    } finally {
      app.get(DemoService).timeScale = 0.01;
    }
  });

  it("reset restores the sample workspace", async () => {
    await post("/api/demo/actions/lunch-team/approve");
    await post("/api/demo/reset");
    const ws = await workspace();
    expect(ws.actions.find((a) => a.id === "lunch-team")!.status).toBe("proposed");
    expect(ws.messages).toEqual([]);
  });

  it("isolation: none of the above touched the agent runtime, integrations, the network or real chat data", async () => {
    await turn("What meetings do I have tomorrow?"); // the real assistant would call the calendar tool
    await post("/api/demo/actions/lunch-team/approve");

    expect(fetchSpy).not.toHaveBeenCalled(); // no Microsoft Graph, no Azure, nothing outbound
    expect(gateway.sent).toEqual([]); // no OpenClaw chat.send
    expect(gateway.sessions.size).toBe(0); // no OpenClaw sessions created
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.appTask.count()).toBe(0);
    expect(await prisma.integrationConnection.count()).toBe(0);
    const audit = await prisma.auditLog.findMany({ where: { action: { startsWith: "demo." } } });
    expect(audit.length).toBeGreaterThan(0);
    expect(audit.every((a) => (a.metadata as { simulated?: boolean }).simulated === true)).toBe(true);
  });
});
