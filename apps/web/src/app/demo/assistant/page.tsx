import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoAssistant } from "@/components/demo/demo-assistant";
import { Spinner } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Demo assistant" };

export default function DemoAssistantPage() {
  return (
    <Suspense
      fallback={
        <div className="grid flex-1 place-items-center" role="status" aria-label="Loading demo assistant">
          <Spinner className="h-5 w-5" />
        </div>
      }
    >
      <DemoAssistant />
    </Suspense>
  );
}
