import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ErrorCodes } from "@personalos/contracts";
import { AppError } from "../common/errors.js";
import { ENV, type Env } from "../config/env.js";
import { type AuthedRequest, IS_PUBLIC, SESSION_COOKIE } from "./auth.decorators.js";
import { AuthService } from "./auth.service.js";

/**
 * CSRF defence for cookie auth: state-changing requests must carry an Origin header
 * that matches the web app. Combined with SameSite=Lax cookies and JSON-only bodies.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private static readonly SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (OriginGuard.SAFE.has(req.method)) return true;
    if (req.headers.origin === new URL(this.env.WEB_ORIGIN).origin) return true;
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
    if (typeof token !== "string" || token.length < 20) throw AppError.unauthenticated();
    const user = await this.auth.authenticate(token);
    if (!user) throw AppError.unauthenticated();
    req.user = user;
    return true;
  }
}
