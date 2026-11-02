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

// ---------- voice ----------
/** "auto" = let the provider pick between the supported locales (never unconstrained detection). */
export const VoiceLanguage = z.enum(["auto", "en-IN", "ta-IN"]);
export type VoiceLanguage = z.infer<typeof VoiceLanguage>;
export const SpeechLocale = z.enum(["en-IN", "ta-IN"]);
export type SpeechLocale = z.infer<typeof SpeechLocale>;

export const VOICE_LIMITS = {
  maxRecordingMs: 60_000,
  minRecordingMs: 400,
  maxAudioBytes: 2 * 1024 * 1024,
  maxSpeechChars: 2_000,
  /** Below this confidence the UI asks the user to double-check the transcript. */
  lowConfidence: 0.6,
} as const;

export const TranscriptionResponse = z.object({
  text: z.string(),
  locale: z.string().nullable(),
  confidence: z.number().nullable(),
  durationMs: z.number().nullable(),
});
export type TranscriptionResponse = z.infer<typeof TranscriptionResponse>;

export const SpeechRequest = z.object({
  text: z.string().trim().min(1).max(VOICE_LIMITS.maxSpeechChars),
  /** Optional override; otherwise inferred from the text's script. */
  locale: SpeechLocale.optional(),
});
export type SpeechRequest = z.infer<typeof SpeechRequest>;

export const VoiceOption = z.object({ id: z.string(), label: z.string(), locale: SpeechLocale, gender: z.enum(["female", "male"]) });
export type VoiceOption = z.infer<typeof VoiceOption>;

export const VoicePreferences = z.object({
  language: VoiceLanguage,
  sttProvider: z.string(),
  ttsProvider: z.string(),
  voiceEn: z.string(),
  voiceTa: z.string(),
  speechRate: z.number().min(0.5).max(2),
  autoSpeak: z.boolean(),
});
export type VoicePreferences = z.infer<typeof VoicePreferences>;

export const UpdateVoicePreferences = VoicePreferences.omit({ sttProvider: true, ttsProvider: true }).partial();
export type UpdateVoicePreferences = z.infer<typeof UpdateVoicePreferences>;

export const VoiceSettings = z.object({
  available: z.boolean(),
  preferences: VoicePreferences,
  voices: z.array(VoiceOption),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

// ---------- integrations ----------
export const IntegrationProvider = z.enum(["microsoft-calendar"]);
export type IntegrationProvider = z.infer<typeof IntegrationProvider>;

export const IntegrationPermission = z.object({ scope: z.string(), description: z.string() });

export const IntegrationSummary = z.object({
  provider: IntegrationProvider,
  label: z.string(),
  /** false when the server lacks configuration (app registration, vault key). */
  available: z.boolean(),
  status: z.enum(["not_connected", "connected", "needs_reconnect"]),
  accountEmail: z.string().nullable(),
  grantedScopes: z.array(z.string()),
  /** What will be requested, in plain words, shown before connecting. */
  permissions: z.array(IntegrationPermission),
  /** What PersonalOS will never do with this connection. */
  never: z.array(z.string()),
  connectedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
});
export type IntegrationSummary = z.infer<typeof IntegrationSummary>;

export const IntegrationList = z.object({ items: z.array(IntegrationSummary) });
export type IntegrationList = z.infer<typeof IntegrationList>;

export const ConnectIntegrationResponse = z.object({ authorizeUrl: z.url() });
export type ConnectIntegrationResponse = z.infer<typeof ConnectIntegrationResponse>;

// ---------- demo workspace ----------
/**
 * Customer demo: sample data and simulated actions only. Served by the API's DemoModule, which
 * has no access to the agent runtime, integrations or any outbound network. Every demo payload
 * carries `simulated: true` so the UI can never present it as real.
 */
export const DemoSource = z.object({ label: z.string(), detail: z.string() });
export type DemoSource = z.infer<typeof DemoSource>;

export const DemoActionStatus = z.enum(["proposed", "approved", "completed", "rejected", "failed"]);
export type DemoActionStatus = z.infer<typeof DemoActionStatus>;

export const DemoLineItem = z.object({ name: z.string(), quantity: z.number().int().positive(), unitPrice: z.number().nonnegative() });
export type DemoLineItem = z.infer<typeof DemoLineItem>;

export const DemoAction = z.object({
  id: z.string(),
  kind: z.enum(["lunch_order", "message"]),
  title: z.string(),
  summary: z.string(),
  status: DemoActionStatus,
  simulated: z.literal(true),
  /** Message actions: who it would go to. */
  recipient: z.object({ name: z.string(), role: z.string(), channel: z.string() }).nullable(),
  /** Message actions: the drafted text. */
  messagePreview: z.string().nullable(),
  /** Lunch orders: vendor, items and money (INR). */
  order: z
    .object({
      vendor: z.string(),
      deliverTo: z.string(),
      deliverBy: z.string(),
      items: z.array(DemoLineItem),
      subtotal: z.number(),
      taxes: z.number(),
      deliveryFee: z.number(),
      total: z.number(),
      currency: z.literal("INR"),
    })
    .nullable(),
  /** Set by the server when the simulated action ends: e.g. "No real order placed." */
  resultNote: z.string().nullable(),
  timeline: z.array(z.object({ status: DemoActionStatus, at: z.string(), note: z.string().nullable() })),
  sources: z.array(DemoSource),
});
export type DemoAction = z.infer<typeof DemoAction>;

export const DemoMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  createdAt: z.string(),
  /** Assistant only: the sample records this answer was built from. */
  sources: z.array(DemoSource),
  /** Assistant only: actions this answer proposed (rendered inline as approval cards). */
  actionIds: z.array(z.string()),
});
export type DemoMessage = z.infer<typeof DemoMessage>;

export const DemoScheduleItem = z.object({ time: z.string(), title: z.string(), detail: z.string(), kind: z.enum(["visit", "registration", "call", "team"]) });
export type DemoScheduleItem = z.infer<typeof DemoScheduleItem>;

export const DemoHighlight = z.object({ label: z.string(), value: z.string(), detail: z.string(), tone: z.enum(["neutral", "attention", "good"]) });
export type DemoHighlight = z.infer<typeof DemoHighlight>;

export const DemoWorkspace = z.object({
  simulated: z.literal(true),
  business: z.object({ name: z.string(), owner: z.string(), city: z.string() }),
  briefing: z.object({
    dateLabel: z.string(),
    headline: z.string(),
    highlights: z.array(DemoHighlight),
    schedule: z.array(DemoScheduleItem),
    sources: z.array(DemoSource),
  }),
  actions: z.array(DemoAction),
  messages: z.array(DemoMessage),
  /** A scripted turn still streaming, if any (resume after reload). */
  activeTurnId: z.string().nullable(),
  /** Services the demo pretends to use, with the access a real connection would need. */
  services: z.array(z.object({ id: z.string(), name: z.string(), purpose: z.string(), access: z.array(z.string()), status: z.literal("simulated") })),
});
export type DemoWorkspace = z.infer<typeof DemoWorkspace>;

export const DemoTurnRequest = z.object({
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});
export type DemoTurnRequest = z.infer<typeof DemoTurnRequest>;

export const DemoTurnResponse = z.object({ turnId: z.string(), deduplicated: z.boolean() });
export type DemoTurnResponse = z.infer<typeof DemoTurnResponse>;

// ---------- health & errors ----------
export const GatewayState = z.enum(["connecting", "connected", "reconnecting", "pairing_required", "down"]);
export type GatewayState = z.infer<typeof GatewayState>;

export const Health = z.object({
  db: z.enum(["ok", "down"]),
  gateway: GatewayState,
  voice: z.enum(["ok", "unconfigured"]),
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
  VOICE_UNAVAILABLE: "VOICE_UNAVAILABLE",
  UNSUPPORTED_AUDIO: "UNSUPPORTED_AUDIO",
  AUDIO_TOO_LARGE: "AUDIO_TOO_LARGE",
  NO_SPEECH: "NO_SPEECH",
  INTEGRATION_UNAVAILABLE: "INTEGRATION_UNAVAILABLE",
  ACTION_NOT_PENDING: "ACTION_NOT_PENDING",
  INTERNAL: "INTERNAL",
} as const;
