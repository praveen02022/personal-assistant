"use client";

import { Check, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Modal dialog on the native <dialog> element: focus is moved in and trapped by the browser,
 * Esc closes, the page behind is inert. Controlled by `open`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  variant = "center",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  /** "sheet-left" slides in from the left (mobile navigation, history). */
  variant?: "center" | "sheet-left";
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault(); // let React state drive closing
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()} // backdrop click
      className={cn(
        "m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] overflow-visible bg-transparent p-0 text-ink backdrop:animate-[fade-in_160ms] open:animate-fade-in",
        variant === "center" && "max-w-lg",
        variant === "sheet-left" && "mt-0 mb-0 ml-0 h-dvh max-h-dvh w-[86%] max-w-[320px]",
        className,
      )}
    >
      <div className={cn("flex max-h-[inherit] flex-col bg-surface shadow-e3", variant === "center" ? "rounded-xl border border-line" : "h-full border-r border-line")}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-title text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-caption text-ink-2">
                {description}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </dialog>
  );
}

export type MenuEntry =
  | { kind: "item"; label: string; icon?: React.ReactNode; onSelect: () => void; danger?: boolean }
  | { kind: "radio"; label: string; icon?: React.ReactNode; checked: boolean; onSelect: () => void }
  | { kind: "label"; label: string }
  | { kind: "separator" };

/** Accessible menu button: arrow keys move, Enter/Space select, Esc or Tab closes. */
export function Menu({ trigger, label, entries, align = "start", side = "bottom" }: { trigger: React.ReactNode; label: string; entries: MenuEntry[]; align?: "start" | "end"; side?: "top" | "bottom" }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = () => Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div className="relative">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 max-md:min-h-11"
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            const all = items();
            const i = all.indexOf(document.activeElement as HTMLElement);
            if (e.key === "ArrowDown") all[(i + 1) % all.length]?.focus();
            else if (e.key === "ArrowUp") all[(i - 1 + all.length) % all.length]?.focus();
            else if (e.key === "Home") all[0]?.focus();
            else if (e.key === "End") all.at(-1)?.focus();
            else if (e.key === "Escape") close();
            else if (e.key === "Tab") close(false);
            else return;
            e.preventDefault();
          }}
          className={cn(
            "absolute z-50 min-w-56 animate-fade-in rounded-lg border border-line bg-surface p-1 shadow-e2",
            align === "end" ? "right-0" : "left-0",
            side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          )}
        >
          {entries.map((entry, i) => {
            if (entry.kind === "separator") return <div key={i} role="separator" className="my-1 h-px bg-line" />;
            if (entry.kind === "label")
              return (
                <div key={i} className="px-2 pt-2 pb-1 text-label text-ink-3" role="presentation">
                  {entry.label}
                </div>
              );
            return (
              <button
                key={i}
                type="button"
                role={entry.kind === "radio" ? "menuitemradio" : "menuitem"}
                aria-checked={entry.kind === "radio" ? entry.checked : undefined}
                tabIndex={-1}
                onClick={() => {
                  entry.onSelect();
                  close();
                }}
                className={cn(
                  "flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-caption outline-none hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none md:h-9 [&_svg]:h-4 [&_svg]:w-4",
                  entry.kind === "item" && entry.danger ? "text-danger" : "text-ink",
                )}
              >
                <span className="text-ink-2">{entry.icon}</span>
                <span className="flex-1">{entry.label}</span>
                {entry.kind === "radio" && entry.checked && <Check className="text-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
