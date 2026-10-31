import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { LoginRequest, type Me } from "@personalos/contracts";
import type { Request, Response } from "express";
import { ZodPipe } from "../common/zod-validation.pipe.js";
import { ENV, type Env } from "../config/env.js";
import { type AuthUser, CurrentUser, Public, SESSION_COOKIE } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(204)
  async login(
    @Body(new ZodPipe(LoginRequest)) body: LoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const { token, expiresAt } = await this.auth.login(body.email, body.password, {
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, // not readable by page scripts
      secure: this.env.COOKIE_SECURE, // HTTPS-only outside local dev
      sameSite: "lax", // not sent on cross-site POST/fetch
      path: "/",
      expires: expiresAt,
    });
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(user);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser): Promise<Me> {
    return this.auth.me(user.id);
  }
}
