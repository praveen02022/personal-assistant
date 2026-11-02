import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { IntegrationList } from "@personalos/contracts";
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
const { hashAgentToken, newAgentToken } = await import("../src/mcp/agent-token.js");

/** Stub of Microsoft identity + Graph. Everything else in the request path is real. */
type MsCall = { url: URL; body: URLSearchParams | null; auth: string | null };
function microsoft() {
  const calls: MsCall[] = [];
  let refreshCount = 0;
  const state = { grantScope: "Calendars.Read User.Read openid profile email", tokenError: null as string | null };
  const fetchStub = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, body: init?.body instanceof URLSearchParams ? init.body : null, auth: headers.Authorization ?? null });
    if (url.hostname === "login.microsoftonline.com") {
      if (state.tokenError) return new Response(JSON.stringify({ error: state.tokenError }), { status: 400 });
      const isRefresh = (init?.body as URLSearchParams).get("grant_type") === "refresh_token";
      if (isRefresh) refreshCount++;
      return new Response(JSON.stringify({ access_token: `at-${refreshCount}`, refresh_token: `rt-${refreshCount}`, expires_in: 3600, scope: state.grantScope }), { status: 200 });
    }
    if (url.pathname === "/v1.0/me") return new Response(JSON.stringify({ mail: "owner@contoso.org" }), { status: 200 });
    if (url.pathname === "/v1.0/me/calendarView") {
      return new Response(
        JSON.stringify({
          value: [
            { id: "e1", subject: "Board review", start: { dateTime: "2026-11-03T05:30:00.0000000" }, end: { dateTime: "2026-11-03T06:30:00.0000000" }, location: { displayName: "Room 4" }, organizer: { emailAddress: { name: "Anita" } }, attendees: [{}, {}, {}], responseStatus: { response: "accepted" } },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("not stubbed", { status: 599 });
  });
  return { calls, state, fetchStub };
}

describe("Microsoft 365 calendar: OAuth, encrypted credentials, and the MCP tool", () => {
  let app: INestApplication;
  let prisma: InstanceType<typeof PrismaService>;
  let cookie: string;
  let agentToken: string;
  let ms: ReturnType<typeof microsoft>;
  const http = () => request(app.getHttpServer());

  const connect = async () => {
    const res = await http().post("/api/integrations/microsoft-calendar/connect").set("Origin", ORIGIN).set("Cookie", cookie);
    expect(res.status).toBe(201);
    return new URL(res.body.authorizeUrl as string);
  };
  const callback = (query: string, sessionCookie = cookie) => http().get(`/api/integrations/microsoft-calendar/callback?${query}`).set("Cookie", sessionCookie);
  const mcp = (body: object, token = agentToken) =>
    http()
      .post("/api/mcp")
      .set("Authorization", `Bearer ${token}`)
      .set("Accept", "application/json, text/event-stream")
      .set("Content-Type", "application/json")
      .send({ jsonrpc: "2.0", id: 1, ...body });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(AgentGateway).useValue(new FakeGateway()).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
    prisma = app.get(PrismaService);
    await resetTestDatabase(prisma);
    const owner = await prisma.user.create({ data: { email: "owner@example.com", displayName: "Owner", passwordHash: await hashPassword("correct horse battery"), preference: { create: { timezone: "Asia/Kolkata" } } } });
    const login = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: "owner@example.com", password: "correct horse battery" });
    cookie = String(login.headers["set-cookie"]).split(";")[0]!;
    agentToken = newAgentToken();
    await prisma.agentAccessToken.create({ data: { userId: owner.id, name: "test", tokenHash: hashAgentToken(agentToken), scopes: ["calendar:read"] } });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await app?.close();
  });

  beforeEach(() => {
    ms = microsoft();
    vi.stubGlobal("fetch", ms.fetchStub);
  });

  it("shows the exact read-only permissions before connecting", async () => {
    const res = await http().get("/api/integrations").set("Cookie", cookie);
    expect(res.body.items[0]).toMatchObject({ provider: "microsoft-calendar", available: true, status: "not_connected", accountEmail: null });
    const item = (res.body as IntegrationList).items[0]!;
    expect(item.permissions.map((p) => p.scope)).toEqual(["Calendars.Read", "User.Read", "offline_access"]);
    expect(item.never.join(" ")).toMatch(/delete events/);
  });

  it("before connecting, the tool tells the agent the calendar isn't connected", async () => {
    const res = await mcp({ method: "tools/call", params: { name: "calendar_list_events", arguments: { day: "tomorrow" } } });
    expect(res.body.result).toMatchObject({ isError: true });
    expect(res.body.result.content[0].text).toMatch(/not connected.*Connections page/);
  });

  describe("OAuth connect", () => {
    it("rejects a forged state, a state from another session, and replays", async () => {
      expect((await callback("code=c&state=forged")).headers.location).toBe(`${ORIGIN}/settings/integrations?result=invalid_state`);

      const url = await connect();
      const state = url.searchParams.get("state")!;
      const other = await prisma.user.create({ data: { email: "other@example.com", displayName: "Other", passwordHash: await hashPassword("another long password") } });
      const otherLogin = await http().post("/api/auth/login").set("Origin", ORIGIN).send({ email: other.email, password: "another long password" });
      const otherCookie = String(otherLogin.headers["set-cookie"]).split(";")[0]!;
      expect((await callback(`code=c&state=${state}`, otherCookie)).headers.location).toMatch(/result=invalid_state/);
      // The state was consumed by that attempt: even the right user can't reuse it.
      expect((await callback(`code=c&state=${state}`)).headers.location).toMatch(/result=invalid_state/);
      expect(ms.calls.some((c) => c.url.pathname.endsWith("/token"))).toBe(false);
    });

    it("refuses a token that carries any write permission and stores nothing", async () => {
      ms.state.grantScope = "Calendars.Read Calendars.ReadWrite User.Read";
      const state = (await connect()).searchParams.get("state")!;
      expect((await callback(`code=c&state=${state}`)).headers.location).toMatch(/result=scope/);
      expect(await prisma.integrationConnection.count()).toBe(0);
      expect(await prisma.integrationCredential.count()).toBe(0);
    });

    it("connects with PKCE + client secret, stores the refresh token only encrypted", async () => {
      const url = await connect();
      expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/authorize");
      expect(url.searchParams.get("scope")).toBe("offline_access User.Read Calendars.Read");
      const res = await callback(`code=auth-code&state=${url.searchParams.get("state")}`);
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe(`${ORIGIN}/settings/integrations?result=connected`);

      const tokenCall = ms.calls.find((c) => c.url.pathname.endsWith("/token"))!;
      expect(tokenCall.body?.get("grant_type")).toBe("authorization_code");
      expect(tokenCall.body?.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(tokenCall.body?.get("client_secret")).toBe("test-client-secret");

      const conn = await prisma.integrationConnection.findFirstOrThrow({ include: { credential: true } });
      expect(conn).toMatchObject({ status: "CONNECTED", accountEmail: "owner@contoso.org" });
      expect(Buffer.from(conn.credential.ciphertext).toString("utf8")).not.toContain("rt-0");
      const raw = await prisma.$queryRawUnsafe<Array<{ c: string }>>(`SELECT encode(ciphertext,'escape') AS c FROM "IntegrationCredential"`);
      expect(raw[0]!.c).not.toContain("rt-0");
      expect(await prisma.oAuthState.count()).toBe(0); // consumed

      const list = await http().get("/api/integrations").set("Cookie", cookie);
      expect(list.body.items[0]).toMatchObject({ status: "connected", accountEmail: "owner@contoso.org" });
    });
  });

  describe("MCP tool endpoint", () => {
    it("requires the agent token (browser cookies don't work here)", async () => {
      expect((await mcp({ method: "tools/list" }, "pos_agt_wrongwrongwrongwrongwrongwrong")).status).toBe(401);
      const withCookie = await http().post("/api/mcp").set("Cookie", cookie).set("Origin", ORIGIN).send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      expect(withCookie.status).toBe(401);
    });

    it("exposes exactly one tool, annotated read-only", async () => {
      const res = await mcp({ method: "tools/list" });
      expect(res.status).toBe(200);
      const tools = res.body.result.tools as Array<{ name: string; annotations: Record<string, boolean> }>;
      expect(tools.map((t) => t.name)).toEqual(["calendar_list_events"]);
      expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    });

    it("answers 'tomorrow' from Graph in the user's timezone", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-02T18:00:00Z") }); // 23:30 IST on 2 Nov
      try {
        const res = await mcp({ method: "tools/call", params: { name: "calendar_list_events", arguments: { day: "tomorrow" } } });
        const view = ms.calls.find((c) => c.url.pathname === "/v1.0/me/calendarView")!;
        expect(view.url.searchParams.get("startDateTime")).toBe("2026-11-02T18:30:00.000Z"); // 00:00 IST 3 Nov
        expect(view.url.searchParams.get("endDateTime")).toBe("2026-11-03T18:30:00.000Z");
        expect(view.auth).toMatch(/^Bearer at-/);
        const result = res.body.result.structuredContent;
        expect(result).toMatchObject({ timezone: "Asia/Kolkata", range: { start_date: "2026-11-03", label: "Tuesday, 3 November 2026" }, count: 1 });
        expect(result.events[0]).toMatchObject({ title: "Board review", start: "11:00", end: "12:00", location: "Room 4", organizer: "Anita", attendees: 3, my_response: "accepted" });
      } finally {
        vi.useRealTimers();
      }
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "tool.calendar_list_events" }, orderBy: { createdAt: "desc" } });
      expect(JSON.stringify(audit.metadata)).not.toContain("Board review"); // metadata only
    });

    it("rotates the refresh token on refresh, and marks NEEDS_RECONNECT when consent is revoked", async () => {
      const service = app.get((await import("../src/integrations/integrations.service.js")).IntegrationsService);
      (service as unknown as { accessTokens: Map<string, unknown> }).accessTokens.clear(); // force a refresh
      const before = await prisma.integrationCredential.findFirstOrThrow();
      await mcp({ method: "tools/call", params: { name: "calendar_list_events", arguments: { day: "today" } } });
      const after = await prisma.integrationCredential.findFirstOrThrow();
      expect(Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext))).toBe(false); // new RT sealed
      expect(ms.calls.find((c) => c.body?.get("grant_type") === "refresh_token")).toBeTruthy();

      (service as unknown as { accessTokens: Map<string, unknown> }).accessTokens.clear();
      ms.state.tokenError = "invalid_grant";
      const res = await mcp({ method: "tools/call", params: { name: "calendar_list_events", arguments: { day: "today" } } });
      expect(res.body.result.content[0].text).toMatch(/expired.*reconnect/);
      expect((await prisma.integrationConnection.findFirstOrThrow()).status).toBe("NEEDS_RECONNECT");
    });

    it("disconnect removes the connection and the encrypted credential", async () => {
      const res = await http().delete("/api/integrations/microsoft-calendar").set("Origin", ORIGIN).set("Cookie", cookie);
      expect(res.status).toBe(204);
      expect(await prisma.integrationConnection.count()).toBe(0);
      expect(await prisma.integrationCredential.count()).toBe(0);
    });
  });
});
