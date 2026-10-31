import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders assistant Markdown. react-markdown builds React elements (no innerHTML) and
 * ignores raw HTML by default, so model output cannot inject markup or scripts.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 leading-relaxed [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded-md [&_code]:bg-surface-2 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.9em] [&_h1]:font-display [&_h1]:text-xl [&_h2]:font-display [&_h2]:text-lg [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-surface-2 [&_pre]:p-3 [&_strong]:font-semibold [&_table]:w-full [&_td]:border [&_td]:border-line [&_td]:px-2 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ href, children: c }) => <a href={href} target="_blank" rel="noopener noreferrer nofollow">{c}</a> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
