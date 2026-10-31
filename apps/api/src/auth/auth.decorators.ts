import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";
import type { Request } from "express";

export const IS_PUBLIC = "isPublic";
/** Opt a route out of the global SessionGuard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export type AuthUser = { id: string; email: string; displayName: string; sessionId: string };
export type AuthedRequest = Request & { user?: AuthUser };

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error("CurrentUser used on a route without SessionGuard");
  return user;
});

export const SESSION_COOKIE = "pos_session";
