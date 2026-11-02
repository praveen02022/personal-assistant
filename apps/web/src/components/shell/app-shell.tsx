"use client";

import type { GatewayState } from "@personalos/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, ClipboardCheck, FlaskConical, Home, LogOut, MessageSquare, Monitor, Moon, Plug, RotateCcw, Settings, Sun, Sunrise } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/ui/logo";
import { Menu } from "@/components/ui/overlay";
import { StatusDot } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type ShellMode = "live" | "demo";
type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; badge?: number };

/** Only destinations that exist. Approvals exists only in the demo (no real approval system yet). */
function navItems(mode: ShellMode, pendingApprovals: number): NavItem[] {
  return mode === "live"
    ? [
        { href: "/", label: "Home", icon: Home },
        { href: "/assistant", label: "Assistant", icon: MessageSquare },
        { href: "/connections", label: "Connections", icon: Plug },
        { href: "/settings", label: "Settings", icon: Settings },
      ]
    : [
        { href: "/demo", label: "Briefing", icon: Sunrise },
        { href: "/demo/assistant", label: "Assistant", icon: MessageSquare },
        { href: "/demo/approvals", label: "Approvals", icon: ClipboardCheck, badge: pendingApprovals },
        { href: "/demo/connections", label: "Connections", icon: Plug },
      ];
}

const isActive = (pathname: string, href: string) => (href === "/" || href === "/demo" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

const GATEWAY: Record<GatewayState, { label: string; tone: "ok" | "warn" | "danger" }> = {
  connected: { label: "Assistant online", tone: "ok" },
  connecting: { label: "Connecting…", tone: "warn" },
  reconnecting: { label: "Reconnecting…", tone: "warn" },
  pairing_required: { label: "Runtime needs pairing", tone: "danger" },
  down: { label: "Assistant offline", tone: "danger" },
};

export function AppShell({ mode, children }: { mode: ShellMode; children: React.ReactNode }) {
  const pathname = usePathname();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const demo = useQuery({ queryKey: ["demo-workspace"], queryFn: api.demo.workspace, enabled: mode === "demo" });
  const pending = demo.data?.actions.filter((a) => a.status === "proposed").length ?? 0;
  const items = navItems(mode, pending);
  const gateway = health.data ? GATEWAY[health.data.gateway] : null;

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <a href="#main" className="sr-only z-50 rounded-md bg-surface px-3 py-2 text-ink shadow-e2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>

      {/* Desktop navigation */}
      <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="px-4 pt-5 pb-4">
          <Link href={mode === "demo" ? "/demo" : "/"} className="inline-flex rounded-md" aria-label={mode === "demo" ? "PersonalOS demo briefing" : "PersonalOS home"}>
            <Logo />
          </Link>
        </div>
        {mode === "demo" && (
          <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-demo-soft px-3 py-2 text-caption font-medium text-demo">
            <FlaskConical className="h-4 w-4" aria-hidden /> Demo workspace
          </div>
        )}
        <nav aria-label="Main" className="px-3">
          <ul className="space-y-0.5">
            {items.map((item) => (
              <li key={item.href}>
                <NavLink item={item} active={isActive(pathname, item.href)} />
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex-1" />
        <div className="space-y-3 px-3 pb-3">
          {mode === "live" ? (
            <Link href="/demo" className="block rounded-lg border border-line bg-surface-2/60 p-3 transition-colors hover:border-line-strong hover:bg-surface-2">
              <span className="flex items-center gap-2 text-caption font-medium text-ink">
                <FlaskConical className="h-4 w-4 text-demo" aria-hidden /> Try the demo
              </span>
              <span className="mt-0.5 block text-label font-normal text-ink-2">A sample real-estate workspace. Nothing real is sent.</span>
            </Link>
          ) : (
            <DemoControls stacked />
          )}
        </div>
        <div className="border-t border-line p-3">
          {mode === "live" && gateway && (
            <p className="mb-2 flex items-center gap-2 px-2 text-label text-ink-2" role="status">
              <StatusDot tone={gateway.tone} /> {gateway.label}
            </p>
          )}
          <AccountMenu side="top" />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-4 md:hidden">
          <Link href={mode === "demo" ? "/demo" : "/"} className="inline-flex h-11 items-center gap-2 rounded-md" aria-label="PersonalOS">
            <LogoMark className="h-7 w-7" />
            <span className="text-heading">PersonalOS</span>
          </Link>
          <div className="flex items-center gap-1">
            {mode === "live" && gateway && (
              <span className="mr-1 inline-flex items-center gap-1.5 text-label text-ink-2" role="status">
                <StatusDot tone={gateway.tone} /> <span className="sr-only sm:not-sr-only">{gateway.label}</span>
              </span>
            )}
            <AccountMenu compact align="end" />
          </div>
        </header>

        {mode === "demo" && <DemoBanner />}

        <main id="main" tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {children}
        </main>

        {/* Mobile tab bar: 4 destinations, 56px targets */}
        <nav aria-label="Main" className="shrink-0 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
          <ul className="grid grid-cols-4">
            {items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn("relative flex h-14 flex-col items-center justify-center gap-0.5 text-label", active ? "text-accent" : "text-ink-2")}
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                    {item.label}
                    {!!item.badge && (
                      <span className="absolute top-1.5 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink" aria-label={`${item.badge} waiting`}>
                        {item.badge}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg px-3 text-[0.875rem] transition-colors",
        active ? "bg-accent-soft font-medium text-accent-soft-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
      )}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      <span className="flex-1">{item.label}</span>
      {!!item.badge && (
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-label font-semibold text-accent-ink tabular" aria-label={`${item.badge} waiting`}>
          {item.badge}
        </span>
      )}
    </Link>
  );
}

function DemoBanner() {
  return (
    <div role="note" aria-label="Demo mode" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-demo-soft px-4 py-2 md:px-6">
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-demo">
        <FlaskConical className="h-4 w-4" aria-hidden /> Demo
      </span>
      <p className="min-w-0 flex-1 text-caption text-ink">
        <span className="md:hidden">Sample data. Actions are simulated.</span>
        <span className="hidden md:inline">Sample data for a fictional real-estate office. Actions are simulated: no real messages, orders or account access.</span>
      </p>
      <div className="md:hidden">
        <Link href="/" className={buttonClass({ variant: "secondary", size: "sm" })}>
          Exit demo
        </Link>
      </div>
    </div>
  );
}

function DemoControls({ stacked = false }: { stacked?: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const reset = useMutation({
    mutationFn: api.demo.reset,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["demo-workspace"] });
      router.push("/demo");
    },
  });
  return (
    <div className={cn("flex gap-2", stacked && "flex-col")}>
      <button type="button" onClick={() => reset.mutate()} disabled={reset.isPending} className={buttonClass({ variant: "ghost", size: "sm", className: "justify-start" })}>
        <RotateCcw className="h-4 w-4" aria-hidden /> {reset.isPending ? "Resetting…" : "Reset demo"}
      </button>
      <Link href="/" className={buttonClass({ variant: "secondary", size: "sm" })}>
        Exit demo
      </Link>
    </div>
  );
}

function AccountMenu({ compact = false, align = "start", side = "bottom" }: { compact?: boolean; align?: "start" | "end"; side?: "top" | "bottom" }) {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const qc = useQueryClient();
  const router = useRouter();
  const { preference, setPreference } = useTheme();
  const name = me.data?.displayName ?? "";
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  async function logout() {
    await api.logout().catch(() => undefined);
    qc.clear();
    router.replace("/login");
  }

  return (
    <Menu
      label="Account menu"
      align={align}
      side={side}
      trigger={
        <>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-label font-semibold text-ink" aria-hidden>
            {initials || "·"}
          </span>
          {!compact && (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-caption font-medium text-ink">{name || "Account"}</span>
                <span className="block truncate text-label font-normal text-ink-3">{me.data?.email}</span>
              </span>
              <ChevronsUpDown className="h-4 w-4 text-ink-3" aria-hidden />
            </>
          )}
        </>
      }
      entries={[
        { kind: "label", label: "Theme" },
        { kind: "radio", label: "Light", icon: <Sun />, checked: preference === "light", onSelect: () => setPreference("light") },
        { kind: "radio", label: "Dark", icon: <Moon />, checked: preference === "dark", onSelect: () => setPreference("dark") },
        { kind: "radio", label: "System", icon: <Monitor />, checked: preference === "system", onSelect: () => setPreference("system") },
        { kind: "separator" },
        { kind: "item", label: "Settings", icon: <Settings />, onSelect: () => router.push("/settings") },
        { kind: "item", label: "Sign out", icon: <LogOut />, onSelect: () => void logout() },
      ]}
    />
  );
}
