import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/config/env.js";
import { localDate, resolveRange, zonedMidnight } from "../src/integrations/calendar-range.js";
import { CredentialVault } from "../src/integrations/credential-vault.js";
import { formatResult } from "../src/integrations/integrations.service.js";
import { GraphUnauthorizedError, listCalendarView } from "../src/integrations/microsoft/graph-calendar.js";
import { authorizeUrl, checkGrantedScopes, newPkce } from "../src/integrations/microsoft/microsoft-oauth.js";

describe("calendar ranges in the user's timezone", () => {
  it("'tomorrow' at 23:30 IST is the next local day even though UTC already rolled over", () => {
    const now = new Date("2026-11-02T18:00:00Z"); // 23:30 IST on 2 Nov
    const r = resolveRange({ day: "tomorrow" }, "Asia/Kolkata", now);
    expect(r.startDate).toBe("2026-11-03");
    expect(r.startUtc.toISOString()).toBe("2026-11-02T18:30:00.000Z"); // 00:00 IST on 3 Nov
    expect(r.endUtc.toISOString()).toBe("2026-11-03T18:30:00.000Z");
  });

  it("handles DST: the 2026-11-01 New York day is 25 hours long", () => {
    const r = resolveRange({ start_date: "2026-11-01" }, "America/New_York");
    expect((r.endUtc.getTime() - r.startUtc.getTime()) / 3_600_000).toBe(25);
    expect(zonedMidnight("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("validates ranges", () => {
    expect(() => resolveRange({ start_date: "2026-11-05", end_date: "2026-11-01" }, "Asia/Kolkata")).toThrow(/before/);
    expect(() => resolveRange({ start_date: "2026-11-01", end_date: "2026-12-01" }, "Asia/Kolkata")).toThrow(/At most 14/);
    expect(() => resolveRange({ start_date: "03-11-2026" }, "Asia/Kolkata")).toThrow(/YYYY-MM-DD/);
    expect(localDate(new Date("2026-11-02T19:00:00Z"), "Asia/Kolkata")).toBe("2026-11-03");
  });
});

describe("CredentialVault (AES-256-GCM)", () => {
  const vault = new CredentialVault({ CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), CREDENTIAL_KEY_VERSION: 1 } as Env);

  it("round-trips, with a fresh IV every time", () => {
    const a = vault.seal("refresh-token-123", "rec-1");
    const b = vault.seal("refresh-token-123", "rec-1");
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.ciphertext).toString("utf8")).not.toContain("refresh-token");
    expect(vault.open(a, "rec-1")).toBe("refresh-token-123");
  });

  it("detects tampering and refuses ciphertext moved to another record", () => {
    const s = vault.seal("secret", "rec-1");
    const tampered = { ...s, ciphertext: Uint8Array.from(s.ciphertext, (x, i) => (i === 0 ? x ^ 1 : x)) };
    expect(() => vault.open(tampered, "rec-1")).toThrow();
    expect(() => vault.open(s, "rec-2")).toThrow(); // AAD binds it to its record
  });

  it("fails closed without a key", () => {
    expect(new CredentialVault({ CREDENTIAL_KEY_VERSION: 1 } as Env).isConfigured()).toBe(false);
  });
});

describe("Microsoft OAuth", () => {
  it("requests only read scopes with PKCE S256", () => {
    const { challenge } = newPkce();
    const url = new URL(authorizeUrl({ tenantId: "t", clientId: "c", clientSecret: "s", redirectUri: "http://localhost:3000/cb" }, "st", challenge));
    expect(url.searchParams.get("scope")).toBe("offline_access User.Read Calendars.Read");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(challenge);
  });

  it("accepts Calendars.Read, rejects missing read or any write scope", () => {
    expect(checkGrantedScopes(["https://graph.microsoft.com/Calendars.Read", "User.Read", "openid"])).toEqual({ ok: true });
    expect(checkGrantedScopes(["User.Read"])).toMatchObject({ ok: false });
    expect(checkGrantedScopes(["Calendars.Read", "Calendars.ReadWrite"])).toMatchObject({ ok: false, reason: /write/ });
    expect(checkGrantedScopes(["Calendars.Read", "Mail.Send"])).toMatchObject({ ok: false });
  });
});

describe("Graph calendarView (read-only)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("selects minimal fields, expands in UTC, skips cancelled, masks private events, paginates", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, headers: init.headers as Record<string, string> });
        const page1 = {
          value: [
            { id: "1", subject: "Standup", start: { dateTime: "2026-11-03T04:30:00.0000000" }, end: { dateTime: "2026-11-03T04:45:00.0000000" }, attendees: [{}, {}], isOnlineMeeting: true, responseStatus: { response: "accepted" } },
            { id: "2", subject: "Cancelled sync", isCancelled: true, start: { dateTime: "2026-11-03T05:00:00" }, end: { dateTime: "2026-11-03T05:30:00" } },
          ],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?page=2",
        };
        const page2 = { value: [{ id: "3", subject: "Doctor", sensitivity: "private", location: { displayName: "Clinic" }, start: { dateTime: "2026-11-03T10:00:00" }, end: { dateTime: "2026-11-03T11:00:00" } }] };
        return new Response(JSON.stringify(url.includes("page=2") ? page2 : page1), { status: 200 });
      }),
    );
    const { events, truncated } = await listCalendarView("at", new Date("2026-11-02T18:30:00Z"), new Date("2026-11-03T18:30:00Z"));
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe("/v1.0/me/calendarView");
    expect(first.searchParams.get("startDateTime")).toBe("2026-11-02T18:30:00.000Z");
    expect(first.searchParams.get("$select")).not.toMatch(/body|bodyPreview|onlineMeetingUrl/);
    expect(calls[0]!.headers.Prefer).toBe('outlook.timezone="UTC"');
    expect(events.map((e) => e.title)).toEqual(["Standup", "Private event"]);
    expect(events[1]!.location).toBeNull();
    expect(truncated).toBe(false);

    const out = formatResult(events, { startDate: "2026-11-03", endDate: "2026-11-03", timezone: "Asia/Kolkata", startUtc: new Date("2026-11-02T18:30:00Z") }, false);
    expect(out.events[0]).toMatchObject({ title: "Standup", date: "2026-11-03", start: "10:00", end: "10:15", attendees: 2, online_meeting: true });
    expect(out.range.label).toBe("Tuesday, 3 November 2026");
  });

  it("surfaces 401 for a token refresh and retries once on throttling", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "0" } }) : new Response("", { status: 401 }))));
    await expect(listCalendarView("at", new Date(), new Date())).rejects.toBeInstanceOf(GraphUnauthorizedError);
    expect(n).toBe(2);
  });
});
