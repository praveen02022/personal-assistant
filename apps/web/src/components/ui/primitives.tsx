import { AlertCircle, CheckCircle2, CircleDashed, CircleSlash, Clock3, FlaskConical, Inbox, LoaderCircle, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/* ---------- Card ---------- */
export function Card({ className, as: As = "section", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "li" }) {
  return <As className={cn("rounded-xl border border-line bg-surface shadow-e1", className)} {...props} />;
}

export function CardHeader({ title, description, action, id, icon }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; id?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon && <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-soft-ink">{icon}</div>}
        <div className="min-w-0">
          <h2 id={id} className="text-heading text-ink">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-caption text-ink-2">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-display text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/* ---------- Badges & status ---------- */
type Tone = "neutral" | "accent" | "ok" | "warn" | "danger" | "info" | "demo";
const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  accent: "bg-accent-soft text-accent-soft-ink border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  info: "bg-info-soft text-info border-transparent",
  demo: "bg-demo-soft text-demo border-transparent",
};

export function Badge({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-label whitespace-nowrap [&_svg]:h-3.5 [&_svg]:w-3.5", toneClass[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

const dotTone: Record<Tone, string> = { neutral: "bg-ink-3", accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-info", demo: "bg-demo" };
export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", dotTone[tone])} />}
      <span className={cn("relative h-2 w-2 rounded-full", dotTone[tone])} />
    </span>
  );
}

/** Lifecycle of an action. Colour is never the only signal: every status has an icon and a word. */
export type ActionStatus = "proposed" | "approved" | "completed" | "rejected" | "failed";
const ACTION_STATUS: Record<ActionStatus, { tone: Tone; label: string; icon: React.ReactNode }> = {
  proposed: { tone: "info", label: "Needs approval", icon: <CircleDashed aria-hidden /> },
  approved: { tone: "accent", label: "Approved", icon: <Clock3 aria-hidden /> },
  completed: { tone: "ok", label: "Completed", icon: <CheckCircle2 aria-hidden /> },
  rejected: { tone: "neutral", label: "Declined", icon: <CircleSlash aria-hidden /> },
  failed: { tone: "danger", label: "Failed", icon: <XCircle aria-hidden /> },
};
export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  const s = ACTION_STATUS[status];
  return (
    <Badge tone={s.tone} icon={s.icon}>
      {s.label}
    </Badge>
  );
}
export const actionStatusLabel = (s: ActionStatus) => ACTION_STATUS[s].label;

export function SampleBadge({ children = "Sample data" }: { children?: React.ReactNode }) {
  return (
    <Badge tone="demo" icon={<FlaskConical aria-hidden />}>
      {children}
    </Badge>
  );
}

/* ---------- Loading, empty and error states ---------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} aria-hidden />;
}

export function LoadingRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn("h-4 w-4 animate-spin text-accent", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-lg bg-surface-2 text-ink-2 [&_svg]:h-5 [&_svg]:w-5">{icon ?? <Inbox aria-hidden />}</div>
      <h3 className="mt-3 text-heading text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-caption text-ink-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-e1">
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-heading text-ink">{title}</p>
        <p className="text-caption text-ink-2">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
        </Button>
      )}
    </div>
  );
}

/** Inline notice (info / success / warning / error) with an icon and text, never colour alone. */
export function Notice({ tone = "info", children, action, className, role = "status" }: { tone?: "info" | "ok" | "warn" | "danger" | "demo"; children: React.ReactNode; action?: React.ReactNode; className?: string; role?: "status" | "alert" | "note" }) {
  const Icon = tone === "ok" ? CheckCircle2 : tone === "danger" ? XCircle : tone === "demo" ? FlaskConical : AlertCircle;
  const color = { info: "text-info", ok: "text-ok", warn: "text-warn", danger: "text-danger", demo: "text-demo" }[tone];
  return (
    <div role={role} className={cn("flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-caption text-ink-2 shadow-e1", className)}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", color)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

/* ---------- Form fields ---------- */
export const fieldClass =
  "h-11 w-full rounded-lg border border-line-strong bg-surface px-3 text-ink shadow-e1 transition-colors outline-none placeholder:text-ink-3 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 focus-visible:outline-none md:h-10";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-label font-normal text-ink-3">{hint}</span>}
    </label>
  );
}

/* ---------- Segmented control (radio group) ---------- */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-1">
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
              e.preventDefault();
              const i = options.findIndex((x) => x.value === value);
              const next = options[(i + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? options.length - 1 : 1)) % options.length]!;
              onChange(next.value);
              (e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus();
            }}
            data-value={o.value}
            className={cn(
              "inline-flex h-11 items-center gap-2 rounded-md px-3 text-caption font-medium transition-colors md:h-8 [&_svg]:h-4 [&_svg]:w-4",
              checked ? "bg-surface text-ink shadow-e1" : "text-ink-2 hover:text-ink",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
