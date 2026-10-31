/**
 * Shared web <-> api contracts. Single source of truth for request validation
 * (backend) and typing (frontend). Nothing OpenClaw-specific leaks through here:
 * the browser never sees session keys, agent ids, run ids, or raw tool payloads.
 */
import { z } from "zod";

// ---------- auth ----------
export const LoginRequest = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(512),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const Me = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  preference: z.object({
    language: z.string(),
    timezone: z.string(),
    assistantName: z.string(),
  }),
});
export type Me = z.infer<typeof Me>;

// ---------- conversations ----------
export const ConversationSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
  activeTaskId: z.string().nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationList = z.object({
  items: z.array(ConversationSummary),
  nextCursor: z.string().nullable(),
});
export type ConversationList = z.infer<typeof ConversationList>;

export const CreateConversationRequest = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});
export type CreateConversationRequest = z.infer<typeof CreateConversationRequest>;

export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const MessageList = z.object({ items: z.array(ChatMessage) });
export type MessageList = z.infer<typeof MessageList>;

export const MAX_MESSAGE_CHARS = 8000;

export const SendMessageRequest = z.object({
  /** Client-generated UUID; resubmitting the same id returns the same task. */
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

// ---------- tasks ----------
export const TaskStatus = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TERMINAL_STATUSES: readonly TaskStatus[] = ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"];
export const isTerminal = (s: TaskStatus) => TERMINAL_STATUSES.includes(s);

export const SendMessageResponse = z.object({
  taskId: z.string(),
  status: TaskStatus,
  /** true when clientRequestId matched an existing task (idempotent resubmit). */
  deduplicated: z.boolean(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponse>;

export const TaskSummary = z.object({
  id: z.string(),
  conversationId: z.string(),
  status: TaskStatus,
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type TaskSummary = z.infer<typeof TaskSummary>;

/** Progress phases come only from real runtime events; never synthesized. */
export const ProgressPhase = z.enum([
  "preparing", // workspace/context preparation
  "thinking", // model call started
  "resumed", // runtime resumed the turn after an interruption (gateway restart)
  "finishing",
]);
export type ProgressPhase = z.infer<typeof ProgressPhase>;

/** Server-Sent Event payloads for GET /api/tasks/:id/events (SSE `event:` = `type`). */
export const TaskEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task.status"), status: TaskStatus }),
  z.object({ type: z.literal("task.progress"), phase: ProgressPhase }),
  z.object({ type: z.literal("tool.started"), toolCallId: z.string(), tool: z.string(), label: z.string() }),
  z.object({ type: z.literal("tool.finished"), toolCallId: z.string(), ok: z.boolean() }),
  /** Cumulative assistant text so far (snapshot, not a delta): simple replay and resume. */
  z.object({ type: z.literal("assistant.text"), text: z.string() }),
  z.object({ type: z.literal("assistant.final"), text: z.string() }),
  z.object({ type: z.literal("task.error"), code: z.string(), message: z.string(), retryable: z.boolean() }),
]);
export type TaskEvent = z.infer<typeof TaskEvent>;
export type TaskEventType = TaskEvent["type"];

// ---------- health & errors ----------
export const GatewayState = z.enum(["connecting", "connected", "reconnecting", "pairing_required", "down"]);
export type GatewayState = z.infer<typeof GatewayState>;

export const Health = z.object({
  db: z.enum(["ok", "down"]),
  gateway: GatewayState,
});
export type Health = z.infer<typeof Health>;

/** Uniform error body for every non-2xx API response. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCodes = {
  VALIDATION_FAILED: "VALIDATION_FAILED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN_ORIGIN: "FORBIDDEN_ORIGIN",
  NOT_FOUND: "NOT_FOUND",
  TASK_IN_PROGRESS: "TASK_IN_PROGRESS",
  GATEWAY_UNAVAILABLE: "GATEWAY_UNAVAILABLE",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL: "INTERNAL",
} as const;
