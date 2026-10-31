import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { mergeChatStreamMessage } from "@openclaw/gateway-client";
import {
  ErrorCodes,
  isTerminal,
  type SendMessageRequest,
  type SendMessageResponse,
  type TaskStatus,
  type TaskSummary,
} from "@personalos/contracts";
import { Subscription } from "rxjs";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { ENV, type Env } from "../config/env.js";
import type { AppTask } from "../generated/prisma/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { AgentGateway, messageText, type RunEvent } from "../gateway/gateway.port.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { decideReconciliation } from "./reconcile.js";
import { TaskStreamRegistry } from "./task-stream.registry.js";

const ACTIVE: TaskStatus[] = ["QUEUED", "RUNNING"];
const SWEEP_INTERVAL_MS = 30_000;
const STALE_RUNNING_MS = 120_000; // no events for this long -> ask the runtime
const QUEUED_GRACE_MS = 60_000; // a QUEUED task older than this lost its submit
const LAST_EVENT_WRITE_INTERVAL_MS = 10_000;

/** User-facing messages per runtime error kind. Raw runtime errors are logged, never shown. */
const ERROR_COPY: Record<string, { code: string; message: string; retryable: boolean; status: TaskStatus }> = {
  timeout: { code: "RUN_TIMEOUT", message: "The assistant took too long to respond.", retryable: true, status: "TIMED_OUT" },
  rate_limit: { code: "RATE_LIMITED", message: "The model is rate limited right now. Try again in a moment.", retryable: true, status: "FAILED" },
  context_length: { code: "CONTEXT_TOO_LONG", message: "This conversation is too long. Start a new one.", retryable: false, status: "FAILED" },
  refusal: { code: "REFUSED", message: "The assistant declined this request.", retryable: false, status: "FAILED" },
};
const GENERIC_ERROR = { code: "AGENT_ERROR", message: "The assistant ran into a problem.", retryable: true, status: "FAILED" as TaskStatus };

type TaskWithSession = AppTask & { conversation: { openClawSessionKey: string } };

export const toSummary = (t: AppTask): TaskSummary => ({
  id: t.id,
  conversationId: t.conversationId,
  status: t.status,
  errorCode: t.errorCode,
  createdAt: t.createdAt.toISOString(),
  completedAt: t.completedAt?.toISOString() ?? null,
});

const deriveTitle = (text: string) => {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
};

@Injectable()
export class TasksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Tasks");
  private readonly subs = new Subscription();
  private sweeper: NodeJS.Timeout | undefined;
  private readonly reconciling = new Set<string>();
  private readonly lastEventWrite = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AgentGateway,
    private readonly registry: TaskStreamRegistry,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    this.subs.add(
      this.gateway.events$.subscribe((ev) => {
        void this.onRunEvent(ev).catch((e: Error) => this.logger.error(`event handling: ${e.message}`));
      }),
    );
    // Every (re)handshake: we may have missed events, and the runtime may have resumed runs under new ids.
    this.subs.add(this.gateway.ready$.subscribe(() => void this.reconcileAll("gateway ready")));
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    this.subs.unsubscribe();
    clearInterval(this.sweeper);
  }

  // ---------- submit ----------

  async submit(userId: string, conversationId: string, dto: SendMessageRequest): Promise<SendMessageResponse> {
    const existing = await this.prisma.appTask.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId: dto.clientRequestId } } });
    if (existing) return this.dedupe(existing, conversationId);
    if (this.gateway.currentState() !== "connected") throw AppError.gatewayUnavailable({ state: this.gateway.currentState() });

    let created: { task: AppTask; sessionKey: string; title: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Row lock serialises concurrent submits for one conversation: the "one active task" check
        // below cannot interleave with another transaction's insert.
        const rows = await tx.$queryRaw<Array<{ openClawSessionKey: string; title: string | null }>>`
          SELECT "openClawSessionKey", "title" FROM "Conversation"
          WHERE "id" = ${conversationId}::uuid AND "userId" = ${userId}::uuid AND "archivedAt" IS NULL
          FOR UPDATE`;
        const conv = rows[0];
        if (!conv) throw AppError.notFound("Conversation");
        const active = await tx.appTask.findFirst({ where: { conversationId, status: { in: ACTIVE } }, select: { id: true } });
        if (active) {
          throw new AppError(ErrorCodes.TASK_IN_PROGRESS, HttpStatus.CONFLICT, "The assistant is still working on the previous message.", {
            details: { taskId: active.id },
          });
        }
        const task = await tx.appTask.create({ data: { userId, conversationId, clientRequestId: dto.clientRequestId } });
        const title = conv.title ?? deriveTitle(dto.text);
        await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(), title } });
        return { task, sessionKey: conv.openClawSessionKey, title };
      });
    } catch (err) {
      // Two identical submits raced past the fast-path check: the unique index decides, return the winner.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await this.prisma.appTask.findUniqueOrThrow({ where: { userId_clientRequestId: { userId, clientRequestId: dto.clientRequestId } } });
        return this.dedupe(winner, conversationId);
      }
      throw err;
    }

    const { task, sessionKey, title } = created;
    // runId === idempotencyKey === task.id (verified in the spike), so events can be routed
    // before chat.send even returns.
    this.registry.ensure(task.id, sessionKey);
    this.registry.bindRun(task.id, task.id);
    this.registry.emit(task.id, { type: "task.status", status: "QUEUED" });

    try {
      await this.gateway.ensureSession(sessionKey, title);
      const { runId } = await this.gateway.sendMessage({ sessionKey, message: dto.text, idempotencyKey: task.id });
      this.registry.bindRun(runId, task.id);
      await this.prisma.appTask.update({ where: { id: task.id }, data: { openClawRunId: runId, runIds: [runId], startedAt: new Date() } });
      // Conditional: a very fast run may already have settled via events.
      const { count } = await this.prisma.appTask.updateMany({ where: { id: task.id, status: "QUEUED" }, data: { status: "RUNNING" } });
      if (count === 1) this.registry.emit(task.id, { type: "task.status", status: "RUNNING" });
    } catch (err) {
      this.logger.warn(`submit ${task.id} failed: ${(err as Error).message}`);
      this.registry.emit(task.id, { type: "task.error", code: ErrorCodes.GATEWAY_UNAVAILABLE, message: "Could not reach the assistant.", retryable: true });
      await this.settle(task.id, "FAILED", "GATEWAY_SEND_FAILED");
      throw err instanceof AppError ? err : AppError.gatewayUnavailable();
    }

    await this.audit.record({ userId, action: "task.submitted", resourceType: "task", resourceId: task.id, correlationId: task.id, metadata: { conversationId } });
    return { taskId: task.id, status: "RUNNING", deduplicated: false };
  }

  private dedupe(task: AppTask, conversationId: string): SendMessageResponse {
    if (task.conversationId !== conversationId) {
      throw new AppError(ErrorCodes.VALIDATION_FAILED, HttpStatus.CONFLICT, "clientRequestId already used for another conversation");
    }
    return { taskId: task.id, status: task.status, deduplicated: true };
  }

  // ---------- runtime events -> task events ----------

  private async onRunEvent(ev: RunEvent) {
    let taskId = this.registry.taskForRun(ev.runId);
    if (!taskId) {
      // A run we never started, in a session where our task is still active: restart recovery.
      const candidate = this.registry.activeTaskForSession(ev.sessionKey);
      if (!candidate || ev.kind === "terminal") return;
      await this.adoptRun(candidate, ev.runId);
      taskId = candidate;
    }
    const stream = this.registry.get(taskId);
    if (!stream || stream.terminal) return;
    this.touch(taskId);

    switch (ev.kind) {
      case "progress":
        if (stream.lastPhase === ev.phase) return;
        stream.lastPhase = ev.phase;
        this.registry.emit(taskId, { type: "task.progress", phase: ev.phase });
        return;
      case "lifecycle-start":
        return;
      case "tool":
        this.registry.emit(
          taskId,
          ev.phase === "start"
            ? { type: "tool.started", toolCallId: ev.toolCallId, tool: ev.name, label: ev.title }
            : { type: "tool.finished", toolCallId: ev.toolCallId, ok: ev.ok ?? false },
        );
        return;
      case "delta": {
        const merged = mergeChatStreamMessage(stream.message, ev.payload);
        if (merged === undefined) return; // append without a baseline: wait for the next snapshot
        const previous = messageText(stream.message);
        stream.message = merged;
        const text = messageText(merged);
        // Spike F5: OpenClaw clears the live text (replace:"") just before `final`. Don't flash empty.
        if (text === "" && previous !== "") return;
        this.registry.emit(taskId, { type: "assistant.text", text });
        return;
      }
      case "terminal":
        await this.onTerminal(taskId, ev);
        return;
    }
  }

  private async onTerminal(taskId: string, ev: Extract<RunEvent, { kind: "terminal" }>) {
    if (ev.state === "final") {
      this.registry.emit(taskId, { type: "assistant.final", text: ev.text });
      await this.settle(taskId, "SUCCEEDED", null);
      return;
    }
    if (ev.state === "aborted") {
      await this.settle(taskId, "CANCELLED", null);
      return;
    }
    const copy = (ev.errorKind && ERROR_COPY[ev.errorKind]) || GENERIC_ERROR;
    this.logger.warn(`task ${taskId} run error kind=${ev.errorKind ?? "unknown"} stop=${ev.stopReason ?? "-"}`);
    this.registry.emit(taskId, { type: "task.error", code: copy.code, message: copy.message, retryable: copy.retryable });
    await this.settle(taskId, copy.status, copy.code);
  }

  /**
   * Idempotent: the event path (first frame of an unknown run) and reconnect reconciliation
   * (chat.history inFlightRun) both discover the same recovery run, often concurrently.
   * The synchronous in-memory check-and-bind happens before any await, so only one caller proceeds.
   */
  private async adoptRun(taskId: string, runId: string) {
    const owner = this.registry.taskForRun(runId);
    if (owner === taskId) return;
    if (owner) {
      // A run belongs to exactly one task; never reassign it.
      this.logger.warn(`refusing to adopt run ${runId} into ${taskId}: already bound to ${owner}`);
      return;
    }
    this.registry.bindRun(runId, taskId);
    // Emit before any await so "resumed" is ordered ahead of the recovery run's own events.
    this.registry.emit(taskId, { type: "task.progress", phase: "resumed" });
    await this.prisma.$executeRaw`
      UPDATE "AppTask" SET "runIds" = array_append("runIds", ${runId}), "lastEventAt" = now()
      WHERE "id" = ${taskId}::uuid AND NOT (${runId} = ANY("runIds"))`;
    await this.audit.record({ action: "task.run_adopted", resourceType: "task", resourceId: taskId, correlationId: runId });
    this.logger.log(`task ${taskId} adopted recovery run ${runId}`);
  }

  private touch(taskId: string) {
    const now = Date.now();
    if (now - (this.lastEventWrite.get(taskId) ?? 0) < LAST_EVENT_WRITE_INTERVAL_MS) return;
    this.lastEventWrite.set(taskId, now);
    void this.prisma.appTask.update({ where: { id: taskId }, data: { lastEventAt: new Date(now) } }).catch(() => undefined);
  }

  /**
   * Moves an active task to a terminal state exactly once. The status predicate makes this
   * safe under races between the event path, reconciliation, the sweeper and cancellation.
   */
  private async settle(taskId: string, status: TaskStatus, errorCode: string | null): Promise<boolean> {
    const { count } = await this.prisma.appTask.updateMany({
      where: { id: taskId, status: { in: ACTIVE } },
      data: { status, errorCode, completedAt: new Date() },
    });
    if (count === 0) return false;
    this.lastEventWrite.delete(taskId);
    const task = await this.prisma.appTask.findUniqueOrThrow({ where: { id: taskId } });
    await this.prisma.conversation.update({ where: { id: task.conversationId }, data: { lastMessageAt: new Date() } });
    this.registry.emit(taskId, { type: "task.status", status });
    await this.audit.record({ userId: task.userId, action: "task.completed", resourceType: "task", resourceId: taskId, correlationId: taskId, metadata: { status, errorCode } });
    return true;
  }

  // ---------- queries & cancel ----------

  async getOwned(userId: string, taskId: string): Promise<TaskWithSession> {
    const task = await this.prisma.appTask.findFirst({
      where: { id: taskId, userId },
      include: { conversation: { select: { openClawSessionKey: true } } },
    });
    if (!task) throw AppError.notFound("Task");
    return task;
  }

  /** Stream for SSE. Rebuilds an empty one for an active task after an API restart. */
  attachStream(task: TaskWithSession) {
    const existing = this.registry.get(task.id);
    if (existing || isTerminal(task.status)) return existing;
    const stream = this.registry.ensure(task.id, task.conversation.openClawSessionKey);
    for (const runId of new Set([task.id, ...task.runIds])) this.registry.bindRun(runId, task.id);
    this.registry.emit(task.id, { type: "task.status", status: task.status });
    return stream;
  }

  async cancel(userId: string, taskId: string): Promise<TaskSummary> {
    const task = await this.getOwned(userId, taskId);
    if (isTerminal(task.status)) return toSummary(task);
    await this.prisma.appTask.update({ where: { id: taskId }, data: { cancelRequested: true } });
    await this.audit.record({ userId, action: "task.cancel_requested", resourceType: "task", resourceId: taskId, correlationId: taskId });

    const runId = task.runIds.at(-1) ?? task.openClawRunId;
    if (!runId) {
      await this.settle(taskId, "CANCELLED", null); // never reached the runtime
    } else {
      const result = await this.gateway.abort({ sessionKey: task.conversation.openClawSessionKey, runId });
      // The `aborted` chat event settles the task. If nothing was running, find out what happened.
      if (!result.aborted) await this.reconcileTask(task, "cancel found no active run");
    }
    return toSummary(await this.prisma.appTask.findUniqueOrThrow({ where: { id: taskId } }));
  }

  // ---------- reconciliation & sweeping ----------

  async reconcileAll(reason: string) {
    const tasks = await this.prisma.appTask.findMany({
      where: { status: { in: ACTIVE } },
      include: { conversation: { select: { openClawSessionKey: true } } },
    });
    if (tasks.length) this.logger.log(`reconciling ${tasks.length} active task(s): ${reason}`);
    for (const task of tasks) {
      if (task.status === "QUEUED" && Date.now() - task.createdAt.getTime() < QUEUED_GRACE_MS) continue; // submit in flight
      await this.reconcileTask(task, reason).catch((e: Error) => this.logger.warn(`reconcile ${task.id}: ${e.message}`));
    }
  }

  async reconcileTask(task: TaskWithSession, reason: string) {
    if (this.reconciling.has(task.id)) return;
    this.reconciling.add(task.id);
    try {
      const sessionKey = task.conversation.openClawSessionKey;
      this.attachStream(task);
      const knownRunIds = [...new Set([task.id, ...task.runIds])];
      const startedAt = task.startedAt ?? task.createdAt;
      const history = await this.gateway.history(sessionKey, 30);
      let decision = decideReconciliation({ knownRunIds, taskStartedAt: startedAt, history, wait: null });
      if (decision.action === "query-wait") {
        const wait = await this.gateway.waitForRun(knownRunIds.at(-1)!, 1000);
        decision = decideReconciliation({ knownRunIds, taskStartedAt: startedAt, history, wait });
      }
      this.logger.log(`reconcile ${task.id} (${reason}): ${JSON.stringify({ ...decision, finalText: undefined })}`);

      switch (decision.action) {
        case "keep-running":
        case "query-wait":
          break;
        case "adopt-run":
          await this.adoptRun(task.id, decision.runId);
          break;
        case "settle":
          if (decision.finalText !== null) this.registry.emit(task.id, { type: "assistant.final", text: decision.finalText });
          if (decision.errorCode === "INTERRUPTED") {
            this.registry.emit(task.id, { type: "task.error", code: "INTERRUPTED", message: "The assistant was interrupted. Please try again.", retryable: true });
          }
          await this.settle(task.id, decision.status, decision.errorCode);
          return;
      }
      if (task.status === "QUEUED") {
        const { count } = await this.prisma.appTask.updateMany({ where: { id: task.id, status: "QUEUED" }, data: { status: "RUNNING", startedAt: new Date() } });
        if (count) this.registry.emit(task.id, { type: "task.status", status: "RUNNING" });
      }
    } finally {
      this.reconciling.delete(task.id);
    }
  }

  private async sweep() {
    if (this.gateway.currentState() !== "connected") return;
    const now = Date.now();
    const tasks = await this.prisma.appTask.findMany({
      where: { status: { in: ACTIVE } },
      include: { conversation: { select: { openClawSessionKey: true } } },
    });
    for (const task of tasks) {
      const started = (task.startedAt ?? task.createdAt).getTime();
      if (task.status === "RUNNING" && now - started > this.env.TASK_MAX_RUNTIME_SECONDS * 1000) {
        this.logger.warn(`task ${task.id} exceeded max runtime; aborting`);
        await this.gateway.abort({ sessionKey: task.conversation.openClawSessionKey, runId: task.runIds.at(-1) ?? task.id }).catch(() => undefined);
        this.registry.emit(task.id, { type: "task.error", code: "RUN_TIMEOUT", message: "The assistant took too long to respond.", retryable: true });
        await this.settle(task.id, "TIMED_OUT", "MAX_RUNTIME");
        continue;
      }
      const lastActivity = (task.lastEventAt ?? task.startedAt ?? task.createdAt).getTime();
      const stale = task.status === "RUNNING" ? now - lastActivity > STALE_RUNNING_MS : now - task.createdAt.getTime() > QUEUED_GRACE_MS;
      if (stale) await this.reconcileTask(task, "stale").catch((e: Error) => this.logger.warn(`sweep ${task.id}: ${e.message}`));
    }
  }
}
