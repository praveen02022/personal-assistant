import { Controller, Get, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { isTerminal, type TaskSummary } from "@personalos/contracts";
import type { Request, Response } from "express";
import { type AuthUser, CurrentUser } from "../auth/auth.decorators.js";
import { UuidParam } from "../common/zod-validation.pipe.js";
import type { SequencedEvent } from "./task-stream.registry.js";
import { TasksService, toSummary } from "./tasks.service.js";

const HEARTBEAT_MS = 15_000;

@Controller("tasks")
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get(":id")
  async get(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string): Promise<TaskSummary> {
    return toSummary(await this.tasks.getOwned(user.id, id));
  }

  @Post(":id/cancel")
  @HttpCode(202)
  cancel(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string): Promise<TaskSummary> {
    return this.tasks.cancel(user.id, id);
  }

  /**
   * Server-Sent Events for one task. Resumable: EventSource resends Last-Event-ID on
   * reconnect and we replay what it missed from the in-memory buffer. The stream ends
   * after a terminal task.status; the client closes its EventSource on that event.
   */
  @Get(":id/events")
  async events(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string, @Req() req: Request, @Res() res: Response) {
    const task = await this.tasks.getOwned(user.id, id); // 404 before any stream bytes
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable proxy buffering (nginx & co.)
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    const write = (e: SequencedEvent) => res.write(`id: ${e.id}\nevent: ${e.event.type}\ndata: ${JSON.stringify(e.event)}\n\n`);
    const stream = this.tasks.attachStream(task);

    if (!stream) {
      // Terminal task with no live buffer (older task or API restarted): one snapshot, no id.
      res.write(`event: task.status\ndata: ${JSON.stringify({ type: "task.status", status: task.status })}\n\n`);
      res.end();
      return;
    }

    const lastEventId = Number(req.headers["last-event-id"]);
    for (const e of stream.replayAfter(Number.isFinite(lastEventId) ? lastEventId : 0)) write(e);
    if (stream.terminal) {
      res.end();
      return;
    }

    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
    const unsubscribe = stream.subscribe((e) => {
      write(e);
      if (e.event.type === "task.status" && isTerminal(e.event.status)) close();
    });
    function close() {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    }
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
