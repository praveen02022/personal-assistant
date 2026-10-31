import { Suspense } from "react";
import { ChatApp } from "@/components/chat/chat-app";

/**
 * Static shell + client app. With Cache Components, the search-param read (selected
 * conversation) is request-time, so the client app streams in behind Suspense.
 */
export default function HomePage() {
  return (
    <Suspense fallback={<div className="grid h-dvh place-items-center text-ink-3">Loading…</div>}>
      <ChatApp />
    </Suspense>
  );
}
