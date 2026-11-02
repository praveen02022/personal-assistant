import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res } from "@nestjs/common";
import { type DemoAction, DemoTurnRequest, type DemoTurnResponse, type DemoWorkspace, isTerminal } from "@personalos/contracts";
import type { Request, Response } from "express";
import { type AuthUser, CurrentUser } from "../auth/auth.decorators.js";
import { AppError } from "../common/errors.js";
import { UuidParam, ZodPipe } from "../common/zod-validation.pipe.js";
import { type DemoStreamEvent, DemoService } from "./demo.service.js";

const HEARTBEAT_MS = 15_000;
/** Action ids are fixed sample slugs; anything else is not a demo action. */
const ActionIdParam = {
  transform(value: unknown): string {
    if (typeof value !== "string" || !/^[a-z0-9-]{1,64}$/.test(value)) throw AppError.notFound("Demo action");
    return value;
  },
};

/**
 * Customer demo: sample data and simulated actions. Signed-in only (same session as the app),
 * Origin-checked like every other state-changing route. Every response is marked simulated.
 */
@Controller("demo")
export class DemoController {
  constructor(private readonly demo: DemoService) {}

  @Get("workspace")
  @Header("X-PersonalOS-Demo", "simulated")
  workspace(@CurrentUser() user: AuthUser): DemoWorkspace {
    return this.demo.workspace(user.id);
  }

  @Post("turns")
  @HttpCode(202)
  @Header("X-PersonalOS-Demo", "simulated")
  startTurn(@CurrentUser() user: AuthUser, @Body(new ZodPipe(DemoTurnRequest)) body: DemoTurnRequest): DemoTurnResponse {
    return this.demo.startTurn(user.id, body);
  }

  @Post("turns/:id/cancel")
  @HttpCode(202)
  cancel(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string) {
    return this.demo.cancelTurn(user.id, id);
  }

  /** Same SSE framing as /api/tasks/:id/events, so the web reuses its stream reducer. */
  @Get("turns/:id/events")
  events(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string, @Req() req: Request, @Res() res: Response) {
    const stream = this.demo.attach(user.id, id);
    if (!stream) throw AppError.notFound("Demo turn");
    res.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-PersonalOS-Demo": "simulated",
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");
    const write = (e: DemoStreamEvent) => res.write(`id: ${e.id}\nevent: ${e.event.type}\ndata: ${JSON.stringify(e.event)}\n\n`);

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

  @Post("actions/:id/approve")
  @HttpCode(200)
  @Header("X-PersonalOS-Demo", "simulated")
  approve(@CurrentUser() user: AuthUser, @Param("id", ActionIdParam) id: string): Promise<DemoAction> {
    return this.demo.decide(user.id, id, "approve");
  }

  @Post("actions/:id/reject")
  @HttpCode(200)
  @Header("X-PersonalOS-Demo", "simulated")
  reject(@CurrentUser() user: AuthUser, @Param("id", ActionIdParam) id: string): Promise<DemoAction> {
    return this.demo.decide(user.id, id, "reject");
  }

  @Post("reset")
  @HttpCode(204)
  reset(@CurrentUser() user: AuthUser): void {
    this.demo.reset(user.id);
  }
}
