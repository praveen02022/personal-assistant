import { createHash, randomBytes } from "node:crypto";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { ErrorCodes, type IntegrationSummary } from "@personalos/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { uuidv7 } from "../common/uuid.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { localDate, resolveRange } from "./calendar-range.js";
import { CredentialVault } from "./credential-vault.js";
import { type CalendarEvent, getMe, GraphUnauthorizedError, listCalendarView } from "./microsoft/graph-calendar.js";
import {
  authorizeUrl,
  checkGrantedScopes,
  exchangeCode,
  MS_CALENDAR_SCOPES,
  type MicrosoftOAuthConfig,
  newPkce,
  ReconnectRequiredError,
  refresh,
} from "./microsoft/microsoft-oauth.js";

export const MS_CALENDAR = "microsoft-calendar" as const;
const STATE_TTL_MS = 10 * 60_000;
const DEFAULT_TZ = "Asia/Kolkata";

/** Plain-language permissions, shown to the user before they connect. */
const PERMISSIONS = [
  { scope: "Calendars.Read", description: "Read events on your calendars: titles, times, locations, organizer and attendee count. Read-only." },
  { scope: "User.Read", description: "Read your basic profile (name and email) to show which account is connected." },
  { scope: "offline_access", description: "Stay connected without signing in every hour. The refresh token is stored encrypted." },
];
const NEVER = [
  "Create, change, accept, decline or delete events (the permission is read-only)",
  "Read or send email",
  "Fetch event descriptions, notes or attachments",
  "Share calendar data with anyone outside PersonalOS and your assistant",
];

/** User-facing failure returned to the agent as a tool error (no secrets, no provider internals). */
export class CalendarToolError extends Error {}

export type CalendarToolResult = {
  timezone: string;
  range: { start_date: string; end_date: string; label: string };
  count: number;
  events: Array<{
    title: string;
    date: string;
    start: string | null;
    end: string | null;
    all_day: boolean;
    location: string | null;
    organizer: string | null;
    attendees: number;
    online_meeting: boolean;
    my_response: string | null;
    show_as: string | null;
  }>;
  truncated: boolean;
};

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger("Integrations");
  private readonly accessTokens = new Map<string, { token: string; expiresAt: number }>();
  private readonly refreshing = new Map<string, Promise<string>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly vault: CredentialVault,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private msConfig(): MicrosoftOAuthConfig | null {
    const { MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI } = this.env;
    if (!MS_TENANT_ID || !MS_CLIENT_ID || !MS_CLIENT_SECRET || !MS_REDIRECT_URI || !this.vault.isConfigured()) return null;
    return { tenantId: MS_TENANT_ID, clientId: MS_CLIENT_ID, clientSecret: MS_CLIENT_SECRET, redirectUri: MS_REDIRECT_URI };
  }

  private requireConfig() {
    const cfg = this.msConfig();
    if (!cfg) throw new AppError(ErrorCodes.INTEGRATION_UNAVAILABLE, HttpStatus.SERVICE_UNAVAILABLE, "Microsoft 365 isn't configured on the server yet.");
    return cfg;
  }

  async list(userId: string): Promise<IntegrationSummary[]> {
    const conn = await this.prisma.integrationConnection.findUnique({ where: { userId_provider: { userId, provider: MS_CALENDAR } } });
    return [
      {
        provider: MS_CALENDAR,
        label: "Microsoft 365 Calendar",
        available: this.msConfig() !== null,
        status: !conn ? "not_connected" : conn.status === "CONNECTED" ? "connected" : "needs_reconnect",
        accountEmail: conn?.accountEmail ?? null,
        grantedScopes: conn?.grantedScopes ?? [],
        permissions: PERMISSIONS,
        never: NEVER,
        connectedAt: conn?.createdAt.toISOString() ?? null,
        lastUsedAt: conn?.lastUsedAt?.toISOString() ?? null,
      },
    ];
  }

  /** Starts OAuth: a one-time state (CSRF) bound to this user, plus a PKCE verifier kept server-side. */
  async beginConnect(userId: string): Promise<string> {
    const cfg = this.requireConfig();
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { verifier, challenge } = newPkce();
    await this.prisma.oAuthState.deleteMany({ where: { OR: [{ userId, provider: MS_CALENDAR }, { expiresAt: { lt: new Date() } }] } });
    await this.prisma.oAuthState.create({
      data: { stateHash, userId, provider: MS_CALENDAR, codeVerifierEncrypted: this.vault.sealToString(verifier, stateHash), expiresAt: new Date(Date.now() + STATE_TTL_MS) },
    });
    await this.audit.record({ userId, action: "integration.connect_started", resourceType: "integration", resourceId: MS_CALENDAR });
    return authorizeUrl(cfg, state, challenge);
  }

  /** OAuth callback. Returns a short reason code for the UI; never throws to the browser. */
  async completeConnect(userId: string, q: { code?: string; state?: string; error?: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const cfg = this.msConfig();
    if (!cfg) return { ok: false, reason: "unavailable" };
    if (!q.state) return { ok: false, reason: "invalid_state" };
    const stateHash = createHash("sha256").update(q.state).digest("hex");
    // Consume atomically: a replayed or concurrent callback finds nothing.
    const st = await this.prisma.oAuthState.delete({ where: { stateHash } }).catch(() => null);
    if (!st || st.userId !== userId || st.provider !== MS_CALENDAR || st.expiresAt < new Date()) return { ok: false, reason: "invalid_state" };
    if (q.error || !q.code) return { ok: false, reason: q.error === "access_denied" ? "denied" : "provider_error" };

    try {
      const tokens = await exchangeCode(cfg, q.code, this.vault.openString(st.codeVerifierEncrypted, stateHash));
      const scopeCheck = checkGrantedScopes(tokens.scopes);
      if (!scopeCheck.ok) {
        this.logger.warn(`connect rejected: ${scopeCheck.reason}`);
        return { ok: false, reason: "scope" };
      }
      const me = await getMe(tokens.accessToken);
      await this.storeConnection(userId, tokens.refreshToken, tokens.scopes, me.email);
      this.accessTokens.set(userId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
      await this.audit.record({ userId, action: "integration.connected", resourceType: "integration", resourceId: MS_CALENDAR, metadata: { scopes: tokens.scopes } });
      return { ok: true };
    } catch (err) {
      this.logger.warn(`connect failed: ${(err as Error).message}`);
      return { ok: false, reason: "exchange_failed" };
    }
  }

  private async storeConnection(userId: string, refreshToken: string, scopes: string[], email: string | null) {
    const credentialId = uuidv7();
    const sealed = this.vault.seal(JSON.stringify({ refreshToken }), credentialId);
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationCredential.create({ data: { id: credentialId, ...sealed } });
      const existing = await tx.integrationConnection.findUnique({ where: { userId_provider: { userId, provider: MS_CALENDAR } } });
      await tx.integrationConnection.upsert({
        where: { userId_provider: { userId, provider: MS_CALENDAR } },
        create: { userId, provider: MS_CALENDAR, status: "CONNECTED", accountEmail: email, grantedScopes: scopes, credentialId },
        update: { status: "CONNECTED", accountEmail: email, grantedScopes: scopes, credentialId, lastError: null },
      });
      if (existing) await tx.integrationCredential.delete({ where: { id: existing.credentialId } });
    });
  }

  async disconnect(userId: string) {
    const conn = await this.prisma.integrationConnection.findUnique({ where: { userId_provider: { userId, provider: MS_CALENDAR } } });
    if (!conn) return;
    await this.prisma.$transaction([
      this.prisma.integrationConnection.delete({ where: { id: conn.id } }),
      this.prisma.integrationCredential.delete({ where: { id: conn.credentialId } }),
    ]);
    this.accessTokens.delete(userId);
    await this.audit.record({ userId, action: "integration.disconnected", resourceType: "integration", resourceId: MS_CALENDAR });
  }

  /** Access tokens live in memory only. Refresh is single-flight per user (refresh tokens rotate). */
  private async accessToken(userId: string, force = false): Promise<string> {
    const cached = this.accessTokens.get(userId);
    if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
    const running = this.refreshing.get(userId);
    if (running) return running;
    const p = this.refreshAccessToken(userId).finally(() => this.refreshing.delete(userId));
    this.refreshing.set(userId, p);
    return p;
  }

  private async refreshAccessToken(userId: string): Promise<string> {
    const cfg = this.msConfig();
    if (!cfg) throw new CalendarToolError("Calendar access isn't configured on the PersonalOS server.");
    const conn = await this.prisma.integrationConnection.findUnique({ where: { userId_provider: { userId, provider: MS_CALENDAR } }, include: { credential: true } });
    if (!conn) throw new CalendarToolError("The user's Microsoft 365 calendar is not connected. Ask them to connect it in PersonalOS on the Connections page.");
    if (conn.status !== "CONNECTED") throw new CalendarToolError("The calendar connection has expired. Ask the user to reconnect it in PersonalOS on the Connections page.");
    const { refreshToken } = JSON.parse(this.vault.open(conn.credential, conn.credentialId)) as { refreshToken: string };
    try {
      const tokens = await refresh(cfg, refreshToken);
      const sealed = this.vault.seal(JSON.stringify({ refreshToken: tokens.refreshToken }), conn.credentialId); // rotate
      await this.prisma.integrationCredential.update({ where: { id: conn.credentialId }, data: sealed });
      this.accessTokens.set(userId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
      return tokens.accessToken;
    } catch (err) {
      if (err instanceof ReconnectRequiredError) {
        await this.prisma.integrationConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_RECONNECT", lastError: err.message } });
        await this.audit.record({ userId, action: "integration.needs_reconnect", resourceType: "integration", resourceId: MS_CALENDAR });
        throw new CalendarToolError("The calendar connection has expired. Ask the user to reconnect it in PersonalOS on the Connections page.");
      }
      throw err;
    }
  }

  /** The read-only calendar tool. Dates are interpreted in the user's timezone. */
  async listEvents(userId: string, args: { day?: "today" | "tomorrow"; start_date?: string; end_date?: string }): Promise<CalendarToolResult> {
    const pref = await this.prisma.userPreference.findUnique({ where: { userId } });
    const tz = pref?.timezone ?? DEFAULT_TZ;
    let range;
    try {
      range = resolveRange(args, tz);
    } catch (err) {
      throw new CalendarToolError((err as Error).message);
    }

    let token = await this.accessToken(userId);
    let result;
    try {
      result = await listCalendarView(token, range.startUtc, range.endUtc);
    } catch (err) {
      if (!(err instanceof GraphUnauthorizedError)) throw err;
      token = await this.accessToken(userId, true); // expired early or revoked: refresh once
      result = await listCalendarView(token, range.startUtc, range.endUtc);
    }
    await this.prisma.integrationConnection.update({ where: { userId_provider: { userId, provider: MS_CALENDAR } }, data: { lastUsedAt: new Date(), lastError: null } });
    await this.audit.record({
      userId,
      action: "tool.calendar_list_events",
      resourceType: "integration",
      resourceId: MS_CALENDAR,
      // Metadata only: never event titles or attendees.
      metadata: { startDate: range.startDate, endDate: range.endDate, timezone: tz, count: result.events.length, truncated: result.truncated },
    });
    return formatResult(result.events, range, result.truncated);
  }
}

export function formatResult(events: CalendarEvent[], range: { startDate: string; endDate: string; timezone: string; startUtc: Date }, truncated: boolean): CalendarToolResult {
  const tz = range.timezone;
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat("en-IN", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const label = range.startDate === range.endDate ? day.format(range.startUtc) : `${range.startDate} to ${range.endDate}`;
  return {
    timezone: tz,
    range: { start_date: range.startDate, end_date: range.endDate, label },
    count: events.length,
    events: events.map((e) => ({
      title: e.title,
      date: localDate(e.allDay ? new Date(e.startUtc.getTime() + 12 * 3_600_000) : e.startUtc, tz),
      start: e.allDay ? null : time.format(e.startUtc),
      end: e.allDay ? null : time.format(e.endUtc),
      all_day: e.allDay,
      location: e.location,
      organizer: e.organizer,
      attendees: e.attendeeCount,
      online_meeting: e.onlineMeeting,
      my_response: e.myResponse,
      show_as: e.showAs,
    })),
    truncated,
  };
}

export { MS_CALENDAR_SCOPES };
