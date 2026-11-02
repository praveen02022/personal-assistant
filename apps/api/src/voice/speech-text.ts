import type { SpeechLocale } from "@personalos/contracts";

/** Tamil Unicode block (U+0B80–U+0BFF). */
const TAMIL = /[஀-௿]/g;
const LETTERS = /\p{L}/gu;

/** Picks the voice locale from the script: mostly-Tamil text gets the Tamil voice. */
export function detectSpeechLocale(text: string): SpeechLocale {
  const tamil = text.match(TAMIL)?.length ?? 0;
  const letters = text.match(LETTERS)?.length ?? 0;
  return letters > 0 && tamil / letters >= 0.3 ? "ta-IN" : "en-IN";
}

/**
 * Turns assistant Markdown into text that sounds natural when read aloud: no "#", "*",
 * backticks, URLs or table pipes. Code blocks are summarised rather than read out.
 * Long answers are cut at a sentence boundary; the full answer stays on screen.
 */
export function toSpeakableText(markdown: string, maxChars: number): string {
  let s = markdown
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links -> link text
    .replace(/https?:\/\/\S+/g, "the link on screen")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullets
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ") // numbered lists
    .replace(/^\s*\|?[-:\s|]+\|[-:\s|]*$/gm, "") // table separator rows
    .replace(/\|/g, ", ")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/[ \t]+/g, " ");

  // Each remaining line becomes a sentence-ish unit so list items get a pause.
  s = s
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (/[.!?।:;]$/.test(l) ? l : `${l}.`))
    .join(" ")
    .trim();

  if (s.length <= maxChars) return s;
  const cut = s.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return `${(lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut).trim()} The rest is on screen.`;
}
