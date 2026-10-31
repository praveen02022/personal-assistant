import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  type ConversationList,
  type ConversationSummary,
  CreateConversationRequest,
  type MessageList,
  SendMessageRequest,
  type SendMessageResponse,
} from "@personalos/contracts";
import { type AuthUser, CurrentUser } from "../auth/auth.decorators.js";
import { UuidParam, ZodPipe } from "../common/zod-validation.pipe.js";
import { TasksService } from "../tasks/tasks.service.js";
import { ConversationsService } from "./conversations.service.js";

@Controller("conversations")
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConversationList> {
    return this.conversations.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateConversationRequest)) body: CreateConversationRequest,
  ): Promise<ConversationSummary> {
    return this.conversations.create(user.id, body.title);
  }

  @Get(":id/messages")
  async messages(@CurrentUser() user: AuthUser, @Param("id", UuidParam) id: string): Promise<MessageList> {
    return { items: await this.conversations.messages(user.id, id) };
  }

  /** 202: accepted for execution; progress arrives on GET /api/tasks/:taskId/events. */
  @Post(":id/messages")
  @HttpCode(202)
  send(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParam) id: string,
    @Body(new ZodPipe(SendMessageRequest)) body: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    return this.tasks.submit(user.id, id, body);
  }
}
