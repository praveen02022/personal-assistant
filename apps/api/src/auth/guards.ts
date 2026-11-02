import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { ErrorCodes } from "@personalos/contracts";
import { AppError } from "../common/errors.js";
import { ENV, type Env } from "../config/env.js";
import { type AuthedRequest, IS_PUBLIC, SESSION_COOKIE } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";

/**
 * CSRF defence for cookie auth: state-changing requests must carry an Origin header
 * that matches the web app. Combined with SameSite=Lax cookies and JSON-only bodies.
 */
const SKIP_ORIGIN = "skipOriginCheck";
/** Only for non-browser endpoints authenticated by a bearer credential (never by cookie). */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN, true);

/**
 * WEB_ORIGIN, plus its loopback aliases when it is localhost: the dev server prints
 * http://127.0.0.1:3000, and a browser on that address sends that Origin. All three name this
 * machine on the same port, so accepting them doesn't let any other site through.
 */
export function allowedOrigins(webOrigin: string): Set<string> {
  const url = new URL(webOrigin);
  const origins = new Set([url.origin]);
  if (url.hostname === "localhost") {
    for (const alias of ["127.0.0.1", "[::1]"]) {
      const u = new URL(url.origin);
      u.hostname = alias;
      origins.add(u.origin);
    }
  }
  return origins;
}

@Injectable()
export class OriginGuard implements CanActivate {
  private static readonly SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (OriginGuard.SAFE.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN, [ctx.getHandler(), ctx.getClass()])) return true;
    if (req.headers.origin && allowedOrigins(this.env.WEB_ORIGIN).has(req.headers.origin)) return true;
    throw new AppError(ErrorCodes.FORBIDDEN_ORIGIN, HttpStatus.FORBIDDEN, "Cross-origin request rejected");
  }
}

/** Global authentication: every route requires a valid session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user = typeof token === "string" && token.length >= 20 ? await this.auth.authenticate(token) : null;
    if (!user) {
      // A cookie that no longer authenticates (expired, revoked, DB reset) is cleared, so the
      // web proxy stops treating the browser as signed in and the login page can recover.
      if (token !== undefined) ctx.switchToHttp().getResponse<Response>().clearCookie(SESSION_COOKIE, { path: "/" });
      throw AppError.unauthenticated();
    }
    req.user = user;
    return true;
  }
}
