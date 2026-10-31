import { Inject, Injectable } from "@nestjs/common";
import type { ChatMessage, ConversationList, ConversationSummary } from "@personalos/contracts";
import { AuditService } from "../audit/audit.service.js";
import { AppError } from "../common/errors.js";
import { uuidv7 } from "../common/uuid.js";
import { ENV, type Env } from "../config/env.js";
import type { Conversation } from "../generated/prisma/client.js";
import { AgentGateway } from "../gateway/gateway.port.js";
import { PrismaService } from "../prisma/prisma.service.js";

const PAGE_SIZE = 50;
const HISTORY_LIMIT = 200;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: AgentGateway,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Session keys are derived server-side; the client can never choose one. */
  private sessionKeyFor(conversationId: string) {
    return `agent:${this.env.OPENCLAW_AGENT_ID}:conv:${conversationId}`;
  }

  async list(userId: string): Promise<ConversationList> {
    const rows = await this.prisma.conversation.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      include: { tasks: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true }, take: 1 } },
    });
    return { items: rows.map((c) => toSummary(c, c.tasks[0]?.id ?? null)), nextCursor: null };
  }

  async create(userId: string, title?: string): Promise<ConversationSummary> {
    const id = uuidv7();
    const conv = await this.prisma.conversation.create({
      data: { id, userId, title: title ?? null, openClawSessionKey: this.sessionKeyFor(id) },
    });
    await this.audit.record({ userId, action: "conversation.created", resourceType: "conversation", resourceId: id });
    return toSummary(conv, null);
  }

  async getOwned(userId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId, archivedAt: null } });
    if (!conv) throw AppError.notFound("Conversation");
    return conv;
  }

  /** Transcript comes from OpenClaw (single source of truth); runtime-injected rows are hidden. */
  async messages(userId: string, conversationId: string): Promise<ChatMessage[]> {
    const conv = await this.getOwned(userId, conversationId);
    if (!conv.lastMessageAt) return []; // nothing sent yet; no runtime session exists
    const history = await this.gateway.history(conv.openClawSessionKey, HISTORY_LIMIT);
    return history.messages
      .filter((m) => !m.internal)
      .map((m) => ({ id: m.id, role: m.role, text: m.text, createdAt: new Date(m.timestamp).toISOString() }));
  }
}

function toSummary(c: Conversation, activeTaskId: string | null): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    activeTaskId,
  };
}
