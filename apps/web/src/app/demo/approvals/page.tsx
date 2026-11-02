import type { Metadata } from "next";
import { DemoApprovals } from "@/components/demo/approvals";

export const metadata: Metadata = { title: "Demo approvals" };

export default function DemoApprovalsPage() {
  return <DemoApprovals />;
}
