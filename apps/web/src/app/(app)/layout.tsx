import { AppShell } from "@/components/shell/app-shell";

/** Connected mode: the real assistant, real connections, real settings. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mode="live">{children}</AppShell>;
}
