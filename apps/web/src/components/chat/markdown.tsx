import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant Markdown. react-markdown builds React elements (no innerHTML) and
 * ignores raw HTML by default, so model output cannot inject markup or scripts.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-[0.96875rem] leading-[1.7] text-ink [&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:decoration-accent/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-accent [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.875em] [&_h1]:text-title [&_h2]:text-heading [&_h3]:text-heading [&_hr]:border-line [&_li]:my-1 [&_li]:pl-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-line [&_pre]:bg-surface-2 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:text-caption [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:bg-surface-2 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:marker:text-ink-3">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** Unique web sources linked from an answer (shown as "Sources" under it). */
export function extractLinks(markdown: string): { href: string; host: string }[] {
  const seen = new Map<string, { href: string; host: string }>();
  for (const m of markdown.matchAll(/\bhttps?:\/\/[^\s)<>\]"']+/g)) {
    try {
      const url = new URL(m[0].replace(/[.,;:!?]+$/, ""));
      const host = url.hostname.replace(/^www\./, "");
      if (!seen.has(host)) seen.set(host, { href: url.toString(), host });
    } catch {
      // not a URL
    }
  }
  return [...seen.values()].slice(0, 6);
}
