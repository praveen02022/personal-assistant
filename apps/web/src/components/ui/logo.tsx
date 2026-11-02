import { cn } from "@/lib/utils";

/** PersonalOS mark: a teal tile with a stacked "window" glyph. Decorative; the wordmark carries the name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="8" y="8" width="16" height="6" rx="2" fill="var(--accent-ink)" />
      <rect x="8" y="16" width="7" height="8" rx="2" fill="var(--accent-ink)" opacity="0.85" />
      <rect x="17" y="16" width="7" height="8" rx="2" fill="var(--accent-ink)" opacity="0.6" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-heading tracking-tight text-ink">PersonalOS</span>
    </span>
  );
}
