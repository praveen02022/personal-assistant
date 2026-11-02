import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink shadow-e1 hover:bg-accent-hover",
  secondary: "border border-line-strong bg-surface text-ink shadow-e1 hover:bg-surface-2",
  outline: "border border-line-strong bg-surface text-ink shadow-e1 hover:bg-surface-2", // alias kept for existing callers
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-line-strong bg-surface text-danger shadow-e1 hover:bg-danger-soft",
};

/** Heights follow the 8px rhythm; below md every control is at least 44px (touch). */
const sizes: Record<Size, string> = {
  sm: "h-11 px-3 text-caption gap-1.5 md:h-8",
  md: "h-11 px-4 text-[0.875rem] gap-2 md:h-10",
  lg: "h-12 px-5 text-[0.9375rem] gap-2",
  icon: "h-11 w-11 justify-center md:h-10 md:w-10",
  "icon-sm": "h-11 w-11 justify-center md:h-8 md:w-8",
};

export function buttonClass({ variant = "primary", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-150 ease-(--ease-standard) select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}
