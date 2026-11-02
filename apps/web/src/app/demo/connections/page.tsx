import type { Metadata } from "next";
import { DemoConnections } from "@/components/demo/demo-connections";

export const metadata: Metadata = { title: "Demo connections" };

export default function DemoConnectionsPage() {
  return <DemoConnections />;
}
