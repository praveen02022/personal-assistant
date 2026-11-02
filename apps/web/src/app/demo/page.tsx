import type { Metadata } from "next";
import { DemoBriefing } from "@/components/demo/briefing";

export const metadata: Metadata = { title: "Demo briefing" };

export default function DemoPage() {
  return <DemoBriefing />;
}
