import { Injectable } from "@nestjs/common";
import { isTerminal, type TaskEvent } from "@personalos/contracts";

export type SequencedEvent = { id: number; event: TaskEvent };
type Listener = (e: SequencedEvent) => void;

const MAX_BUFFERED = 300;
const RETAIN_AFTER_TERMINAL_MS = 5 * 60_000;

/**
 * In-memory, per-task event log for live SSE delivery and Last-Event-ID resume.
 * Not durable: after an API restart the stream is rebuilt from reconciliation and
 * the client reloads the transcript. A multi-instance deployment would move this
 * fan-out to Redis pub/sub (Phase 6), keyed the same way.
 */
class TaskStream {
  private seq = 0;
  private events: SequencedEvent[] = [];
  private listeners = new Set<Listener>();
  /** Latest merged assistant message (OpenClaw message object), for delta merging. */
  message: unknown = undefined;
  /** Last progress phase emitted; consecutive duplicates (two "preparing" sub-steps) are dropped. */
  lastPhase: string | null = null;
  terminal = false;

  constructor(
    readonly taskId: string,
    readonly sessionKey: string,
  ) {}

  push(event: TaskEvent): SequencedEvent | undefined {
    if (this.terminal) return undefined; // nothing may follow the terminal status
    const e = { id: ++this.seq, event };
    // assistant.text is a cumulative snapshot: keep only the newest one in the replay buffer.
    if (event.type === "assistant.text") this.events = this.events.filter((x) => x.event.type !== "assistant.text");
    this.events.push(e);
    if (this.events.length > MAX_BUFFERED) this.events.splice(0, this.events.length - MAX_BUFFERED);
    if (event.type === "task.status" && isTerminal(event.status)) this.terminal = true;
    for (const l of this.listeners) l(e);
    return e;
  }

  replayAfter(lastId: number): SequencedEvent[] {
    return this.events.filter((e) => e.id > lastId);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

@Injectable()
export class TaskStreamRegistry {
  private readonly streams = new Map<string, TaskStream>();
  private readonly runToTask = new Map<string, string>();
  private readonly activeBySession = new Map<string, string>();

  ensure(taskId: string, sessionKey: string): TaskStream {
    let s = this.streams.get(taskId);
    if (!s) {
      s = new TaskStream(taskId, sessionKey);
      this.streams.set(taskId, s);
    }
    this.activeBySession.set(sessionKey, taskId);
    return s;
  }

  get(taskId: string): TaskStream | undefined {
    return this.streams.get(taskId);
  }

  bindRun(runId: string, taskId: string) {
    this.runToTask.set(runId, taskId);
  }

  taskForRun(runId: string): string | undefined {
    return this.runToTask.get(runId);
  }

  /** The non-terminal task for a session (used to adopt restart-recovery runs). */
  activeTaskForSession(sessionKey: string): string | undefined {
    const id = this.activeBySession.get(sessionKey);
    return id && !this.streams.get(id)?.terminal ? id : undefined;
  }

  emit(taskId: string, event: TaskEvent): SequencedEvent | undefined {
    const s = this.streams.get(taskId);
    if (!s) return undefined;
    const e = s.push(event);
    if (e && s.terminal) this.scheduleCleanup(s);
    return e;
  }

  private scheduleCleanup(s: TaskStream) {
    if (this.activeBySession.get(s.sessionKey) === s.taskId) this.activeBySession.delete(s.sessionKey);
    setTimeout(() => {
      this.streams.delete(s.taskId);
      for (const [run, task] of this.runToTask) if (task === s.taskId) this.runToTask.delete(run);
    }, RETAIN_AFTER_TERMINAL_MS).unref();
  }
}
