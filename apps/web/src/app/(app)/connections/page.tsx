import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionsView } from "@/components/connections/connections";
import { LoadingRows } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
          <LoadingRows rows={2} label="Loading connections" />
        </div>
      }
    >
      <ConnectionsView />
    </Suspense>
  );
}
