import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

export type AgentPrincipal = { tokenId: string; userId: string; scopes: string[] };

export const hashAgentToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newAgentToken = () => `pos_agt_${randomBytes(32).toString("base64url")}`;

/**
 * Authenticates an agent runtime (one OpenClaw Gateway = one user) calling PersonalOS tools.
 * Separate from browser sessions: different credential, scoped, revocable, and it can only
 * reach the tool endpoint.
 */
@Injectable()
export class AgentTokenService {
  private lastTouch = new Map<string, number>();
  constructor(private readonly prisma: PrismaService) {}

  async authenticate(authorization: string | undefined): Promise<AgentPrincipal | null> {
    const m = authorization?.match(/^Bearer\s+(pos_agt_[A-Za-z0-9_-]{20,})$/);
    if (!m) return null;
    const row = await this.prisma.agentAccessToken.findUnique({ where: { tokenHash: hashAgentToken(m[1]!) } });
    if (!row || row.revokedAt) return null;
    if (Date.now() - (this.lastTouch.get(row.id) ?? 0) > 60_000) {
      this.lastTouch.set(row.id, Date.now());
      await this.prisma.agentAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    }
    return { tokenId: row.id, userId: row.userId, scopes: row.scopes };
  }
}
