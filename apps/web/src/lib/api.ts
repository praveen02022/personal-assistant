import {
  ApiError,
  type ChatMessage,
  type ConversationList,
  type ConversationSummary,
  type Health,
  type LoginRequest,
  type Me,
  type SendMessageRequest,
  type SendMessageResponse,
  type TaskSummary,
} from "@personalos/contracts";

export const UNAUTHENTICATED_EVENT = "personalos:unauthenticated";

/** Thrown for every non-2xx response; carries the API's stable error code. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.dispatchEvent(new Event(UNAUTHENTICATED_EVENT)); // session expired or revoked; the shell navigates
  }
  if (!res.ok) {
    const parsed = ApiError.safeParse(await res.json().catch(() => null));
    if (parsed.success) {
      const e = parsed.data.error;
      throw new ApiRequestError(res.status, e.code, e.message, e.retryable ?? false, e.details);
    }
    throw new ApiRequestError(res.status, "HTTP_ERROR", `Request failed (${res.status})`, res.status >= 500);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  login: (body: LoginRequest) => post<void>("/auth/login", body),
  logout: () => post<void>("/auth/logout"),
  me: () => request<Me>("/auth/me"),
  health: () => request<Health>("/health"),
  conversations: () => request<ConversationList>("/conversations"),
  createConversation: () => post<ConversationSummary>("/conversations"),
  messages: (conversationId: string) => request<{ items: ChatMessage[] }>(`/conversations/${conversationId}/messages`),
  send: (conversationId: string, body: SendMessageRequest) => post<SendMessageResponse>(`/conversations/${conversationId}/messages`, body),
  cancel: (taskId: string) => post<TaskSummary>(`/tasks/${taskId}/cancel`),
};
