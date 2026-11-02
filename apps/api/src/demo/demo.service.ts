import { HttpStatus, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { type DemoAction, type DemoMessage, type DemoTurnResponse, type DemoWorkspace, ErrorCodes, isTerminal, type TaskEvent } from "@personalos/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { uuidv7 } from "../common/uuid.js";
import { BUSINESS, dateLabel, highlights, SCHEDULE_TODAY, seedActions, SERVICES, SOURCES } from "./demo-data.js";
import { detectIntent, replyFor, type ScriptedReply, scriptEvents } from "./demo-script.js";

/**
 * Demo workspace state, in memory and per user. Restarting the API (or "Reset demo") starts over.
 *
 * Isolation is structural: this service depends only on the audit log. It has no handle on the
 * agent runtime, integrations, credentials, voice providers or `fetch`, and its action endpoints
 * accept only fixed sample ids (no recipients, numbers or amounts from the client). Enforced by
 * test/demo.isolation.spec.ts.
 */
export type DemoStreamEvent = { id: number; event: TaskEvent };

type Turn = {
  id: string;
  clientRequestId: string;
  userText: string;
  startedAt: number;
  reply: ScriptedReply;
  buffer: DemoStreamEvent[];
  subscribers: Set<(e: DemoStreamEvent) => void>;
  timers: NodeJS.Timeout[];
  outcome: "running" | "succeeded" | "cancelled";
  finishedAt: number | null;
};

type UserState = { actions: DemoAction[]; turns: Turn[] };

const MAX_TURNS = 60;

@Injectable()
export class DemoService implements OnModuleDestroy {
  /** Tests speed the script up; 1 = real time (a turn takes ~2–4 s). */
  timeScale = 1;
  private readonly users = new Map<string, UserState>();

  constructor(private readonly audit: AuditService) {}

  onModuleDestroy() {
    for (const state of this.users.values()) for (const t of state.turns) t.timers.forEach(clearTimeout);
  }

  private state(userId: string): UserState {
    let s = this.users.get(userId);
    if (!s) {
      s = { actions: seedActions(new Date()), turns: [] };
      this.users.set(userId, s);
    }
    return s;
  }

  workspace(userId: string): DemoWorkspace {
    const s = this.state(userId);
    const now = new Date();
    const pending = s.actions.filter((a) => a.status === "proposed").length;
    return {
      simulated: true,
      business: { ...BUSINESS },
      briefing: {
        dateLabel: dateLabel(now),
        headline: `A site visit at 11, a registration at 3, and ${pending === 0 ? "nothing" : pending === 1 ? "1 thing" : `${pending} things`} waiting for your approval.`,
        highlights: highlights(pending),
        schedule: SCHEDULE_TODAY,
        sources: [SOURCES.calendar, SOURCES.crm, SOURCES.payments],
      },
      actions: structuredClone(s.actions),
      messages: this.messages(s),
      activeTurnId: s.turns.find((t) => t.outcome === "running")?.id ?? null,
      services: SERVICES,
    };
  }

  private messages(s: UserState): DemoMessage[] {
    const out: DemoMessage[] = [];
    for (const t of s.turns) {
      out.push({ id: `${t.id}:u`, role: "user", text: t.userText, createdAt: new Date(t.startedAt).toISOString(), sources: [], actionIds: [] });
      if (t.outcome === "succeeded") {
        out.push({ id: `${t.id}:a`, role: "assistant", text: t.reply.text, createdAt: new Date(t.finishedAt!).toISOString(), sources: t.reply.sources, actionIds: t.reply.actionIds });
      }
    }
    return out;
  }

  /** Starts a scripted turn. Same rules as real chat: one at a time, idempotent per clientRequestId. */
  startTurn(userId: string, body: { clientRequestId: string; text: string }): DemoTurnResponse {
    const s = this.state(userId);
    const existing = s.turns.find((t) => t.clientRequestId === body.clientRequestId);
    if (existing) return { turnId: existing.id, deduplicated: true };
    const active = s.turns.find((t) => t.outcome === "running");
    if (active) {
      throw new AppError(ErrorCodes.TASK_IN_PROGRESS, HttpStatus.CONFLICT, "The demo assistant is still answering the previous message.", { details: { taskId: active.id } });
    }

    const id = uuidv7();
    const reply = replyFor(detectIntent(body.text), s.actions);
    const turn: Turn = { id, clientRequestId: body.clientRequestId, userText: body.text, startedAt: Date.now(), reply, buffer: [], subscribers: new Set(), timers: [], outcome: "running", finishedAt: null };
    for (const { atMs, event } of scriptEvents(id, reply)) {
      turn.timers.push(setTimeout(() => this.publish(turn, event), Math.round(atMs * this.timeScale)));
    }
    s.turns.push(turn);
    if (s.turns.length > MAX_TURNS) s.turns.splice(0, s.turns.length - MAX_TURNS);
    return { turnId: id, deduplicated: false };
  }

  private publish(turn: Turn, event: TaskEvent) {
    if (turn.outcome === "cancelled") return;
    if (event.type === "task.status" && event.status === "SUCCEEDED") {
      turn.outcome = "succeeded";
      turn.finishedAt = Date.now();
    }
    const e = { id: turn.buffer.length + 1, event };
    turn.buffer.push(e);
    for (const fn of turn.subscribers) fn(e);
  }

  /** Replays what the caller missed, then follows live. Returns null for an unknown turn. */
  attach(userId: string, turnId: string) {
    const turn = this.state(userId).turns.find((t) => t.id === turnId);
    if (!turn) return null;
    return {
      replayAfter: (lastId: number) => turn.buffer.filter((e) => e.id > lastId),
      get terminal() {
        const last = turn.buffer.at(-1)?.event;
        return last?.type === "task.status" && isTerminal(last.status);
      },
      subscribe: (fn: (e: DemoStreamEvent) => void) => {
        turn.subscribers.add(fn);
        return () => turn.subscribers.delete(fn);
      },
    };
  }

  cancelTurn(userId: string, turnId: string) {
    const turn = this.state(userId).turns.find((t) => t.id === turnId);
    if (!turn) throw AppError.notFound("Demo turn");
    if (turn.outcome !== "running") return { turnId, status: turn.outcome };
    turn.timers.forEach(clearTimeout);
    this.publish(turn, { type: "task.status", status: "CANCELLED" });
    turn.outcome = "cancelled";
    turn.finishedAt = Date.now();
    return { turnId, status: turn.outcome };
  }

  /** Simulated execution: the server decides the outcome and the result text, never the client. */
  async decide(userId: string, actionId: string, decision: "approve" | "reject"): Promise<DemoAction> {
    const action = this.state(userId).actions.find((a) => a.id === actionId);
    if (!action) throw AppError.notFound("Demo action");
    if (action.status !== "proposed") {
      throw new AppError(ErrorCodes.ACTION_NOT_PENDING, HttpStatus.CONFLICT, `This action is already ${action.status}.`);
    }
    const now = new Date().toISOString();
    const nothing = action.kind === "lunch_order" ? "No real order placed." : "No real message sent.";
    if (decision === "approve") {
      action.timeline.push({ status: "approved", at: now, note: null }, { status: "completed", at: now, note: `Simulated · ${nothing}` });
      action.status = "completed";
      action.resultNote = nothing;
    } else {
      action.timeline.push({ status: "rejected", at: now, note: "You declined" });
      action.status = "rejected";
      action.resultNote = `Declined. ${nothing}`;
    }
    await this.audit.record({ userId, action: `demo.action_${decision}d`, resourceType: "demo_action", resourceId: action.id, metadata: { simulated: true, kind: action.kind } });
    return structuredClone(action);
  }

  reset(userId: string) {
    const s = this.users.get(userId);
    if (s) for (const t of s.turns) t.timers.forEach(clearTimeout);
    this.users.delete(userId);
  }
}
