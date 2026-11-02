import { AppShell } from "@/components/shell/app-shell";

/** Demo mode: sample data and simulated actions, visibly separate from the connected assistant. */
export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <AppShell mode="demo">{children}</AppShell>;
}
