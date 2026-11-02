import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge must know our semantic type scale is font-size, not colour (else it drops text colours). */
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "heading", "body", "caption", "label"] }] } },
});

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "Good evening";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
