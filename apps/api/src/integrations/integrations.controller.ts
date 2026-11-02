import { Controller, Delete, Get, HttpCode, Inject, Post, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { ConnectIntegrationResponse, IntegrationList } from "@personalos/contracts";
import type { Response } from "express";
import { type AuthUser, CurrentUser } from "../auth/auth.decorators.js";
import { ENV, type Env } from "../config/env.js";
import { IntegrationsService } from "./integrations.service.js";

@Controller("integrations")
export class IntegrationsController {
  constructor(
    private readonly integrations: IntegrationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthUser): Promise<IntegrationList> {
    return { items: await this.integrations.list(user.id) };
  }

  /** POST (Origin-checked) so another site can't start a connect flow for the user. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("microsoft-calendar/connect")
  async connect(@CurrentUser() user: AuthUser): Promise<ConnectIntegrationResponse> {
    return { authorizeUrl: await this.integrations.beginConnect(user.id) };
  }

  /**
   * Microsoft redirects the browser here (top-level GET, so the SameSite=Lax session cookie is sent).
   * The one-time state must belong to this signed-in user. Always redirects back to the UI.
   */
  @Get("microsoft-calendar/callback")
  async callback(
    @CurrentUser() user: AuthUser,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.integrations.completeConnect(user.id, { code, state, error });
    const target = new URL("/settings/integrations", this.env.WEB_ORIGIN);
    target.searchParams.set("result", result.ok ? "connected" : result.reason);
    res.redirect(303, target.toString());
  }

  @Delete("microsoft-calendar")
  @HttpCode(204)
  async disconnect(@CurrentUser() user: AuthUser): Promise<void> {
    await this.integrations.disconnect(user.id);
  }
}
