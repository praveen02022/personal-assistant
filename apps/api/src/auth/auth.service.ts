import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ErrorCodes, type Me } from "@personalos/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { ENV, type Env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { AuthUser } from "./auth.decorators.js";
import { hashSessionToken, newSessionToken, timingSafeDummyVerify, verifyPassword } from "./crypto.js";

const LAST_SEEN_WRITE_INTERVAL_MS = 5 * 60_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, meta: { userAgent?: string | undefined; ip?: string | undefined }) {
    const user = await this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    if (!user) {
      await timingSafeDummyVerify(password); // equalise timing: no user enumeration
      await this.audit.record({ action: "auth.login_failed", resourceType: "user", metadata: { reason: "unknown_email" } });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, "Email or password is incorrect");
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      await this.audit.record({ userId: user.id, action: "auth.login_failed", resourceType: "user", resourceId: user.id });
      throw new AppError(ErrorCodes.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED, "Email or password is incorrect");
    }

    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + this.env.SESSION_TTL_HOURS * 3_600_000);
    const session = await this.prisma.authSession.create({
      data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt, userAgent: meta.userAgent?.slice(0, 256) ?? null },
    });
    await this.audit.record({
      userId: user.id,
      action: "auth.login",
      resourceType: "auth_session",
      resourceId: session.id,
      metadata: { ip: meta.ip ?? null },
    });
    return { token, expiresAt };
  }

  /** Resolves a cookie token to a user, or null. Sliding lastSeenAt, written at most every 5 minutes. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date()) return null;
    if (Date.now() - session.lastSeenAt.getTime() > LAST_SEEN_WRITE_INTERVAL_MS) {
      await this.prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    }
    return { id: session.user.id, email: session.user.email, displayName: session.user.displayName, sessionId: session.id };
  }

  async logout(user: AuthUser) {
    await this.prisma.authSession.deleteMany({ where: { id: user.sessionId } });
    await this.audit.record({ userId: user.id, action: "auth.logout", resourceType: "auth_session", resourceId: user.sessionId });
  }

  async me(userId: string): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { preference: true } });
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      preference: {
        language: user.preference?.language ?? "en-IN",
        timezone: user.preference?.timezone ?? "Asia/Kolkata",
        assistantName: user.preference?.assistantName ?? "Assistant",
      },
    };
  }
}
