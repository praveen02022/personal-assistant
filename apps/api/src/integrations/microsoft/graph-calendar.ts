/**
 * Microsoft Graph, read-only. `calendarView` expands recurring meetings into instances
 * within the window (unlike `events`). Only the fields an answer needs are selected:
 * no bodies/descriptions (private, and a prompt-injection vector), no join URLs.
 */

export type CalendarEvent = {
  id: string;
  title: string;
  startUtc: Date;
  endUtc: Date;
  allDay: boolean;
  location: string | null;
  organizer: string | null;
  attendeeCount: number;
  onlineMeeting: boolean;
  myResponse: string | null;
  showAs: string | null;
  private: boolean;
};

export class GraphUnauthorizedError extends Error {}
export class GraphError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SELECT = ["subject", "start", "end", "isAllDay", "isCancelled", "location", "organizer", "attendees", "isOnlineMeeting", "showAs", "responseStatus", "sensitivity"].join(",");
const PAGE_SIZE = 50;
const MAX_PAGES = 3;

type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime: string };
  end?: { dateTime: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: unknown[];
  isOnlineMeeting?: boolean;
  showAs?: string;
  responseStatus?: { response?: string };
  sensitivity?: string;
};

/** Graph returns "2026-11-03T04:30:00.0000000" with Prefer: outlook.timezone="UTC". */
const parseUtc = (s: string) => new Date(s.endsWith("Z") ? s : `${s.replace(/\.\d+$/, "")}Z`);

export async function listCalendarView(accessToken: string, startUtc: Date, endUtc: Date, signal?: AbortSignal) {
  const first = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  first.search = new URLSearchParams({
    startDateTime: startUtc.toISOString(),
    endDateTime: endUtc.toISOString(),
    $select: SELECT,
    $orderby: "start/dateTime",
    $top: String(PAGE_SIZE),
  }).toString();

  const events: CalendarEvent[] = [];
  let next: string | null = first.toString();
  let pages = 0;
  while (next && pages < MAX_PAGES) {
    const page = await getWithRetry(next, accessToken, signal);
    for (const e of page.value) {
      if (e.isCancelled || !e.start || !e.end) continue;
      const isPrivate = e.sensitivity === "private" || e.sensitivity === "confidential";
      events.push({
        id: e.id,
        title: isPrivate ? "Private event" : (e.subject?.trim() || "(no title)"),
        startUtc: parseUtc(e.start.dateTime),
        endUtc: parseUtc(e.end.dateTime),
        allDay: !!e.isAllDay,
        location: isPrivate ? null : e.location?.displayName?.trim() || null,
        organizer: e.organizer?.emailAddress?.name ?? e.organizer?.emailAddress?.address ?? null,
        attendeeCount: e.attendees?.length ?? 0,
        onlineMeeting: !!e.isOnlineMeeting,
        myResponse: e.responseStatus?.response ?? null,
        showAs: e.showAs ?? null,
        private: isPrivate,
      });
    }
    next = page["@odata.nextLink"] ?? null;
    pages++;
  }
  return { events, truncated: next !== null };
}

/** One retry for throttling/transient errors, honouring Retry-After (capped). 401 -> caller refreshes. */
async function getWithRetry(url: string, accessToken: string, signal?: AbortSignal, attempt = 0): Promise<{ value: GraphEvent[]; "@odata.nextLink"?: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"', Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
  if (res.status === 401) throw new GraphUnauthorizedError("graph 401");
  if ((res.status === 429 || res.status >= 500) && attempt === 0) {
    const retryAfter = Math.min(5, Number(res.headers.get("retry-after")) || 1);
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return getWithRetry(url, accessToken, signal, 1);
  }
  if (!res.ok) throw new GraphError(res.status, `graph ${res.status}`);
  return (await res.json()) as { value: GraphEvent[]; "@odata.nextLink"?: string };
}

export async function getMe(accessToken: string, signal?: AbortSignal): Promise<{ email: string | null }> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { email: null };
  const me = (await res.json()) as { mail?: string; userPrincipalName?: string };
  return { email: me.mail ?? me.userPrincipalName ?? null };
}
