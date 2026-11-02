import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatApp } from "@/components/chat/chat-app";
import { Spinner } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Assistant" };

/**
 * Static shell + client app. With Cache Components, the search-param read (selected
 * conversation) is request-time, so the client app streams in behind Suspense.
 */
export default function AssistantPage() {
  return (
    <Suspense
      fallback={
        <div className="grid flex-1 place-items-center" role="status" aria-label="Loading assistant">
          <Spinner className="h-5 w-5" />
        </div>
      }
    >
      <ChatApp />
    </Suspense>
  );
}
