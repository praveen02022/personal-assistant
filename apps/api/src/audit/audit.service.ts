import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { PrismaService } from "../prisma/prisma.service.js";

export type AuditEntry = {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  correlationId?: string | null;
  /** Metadata only. Never prompts, message text, tokens, or tool payloads. */
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger("Audit");
  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: an audit write failure must not fail the user's request. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId ?? null,
          action: entry.action,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          correlationId: entry.correlationId ?? null,
          metadata: entry.metadata ?? {},
        },
      });
    } catch (err) {
      this.logger.error(`audit write failed for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
