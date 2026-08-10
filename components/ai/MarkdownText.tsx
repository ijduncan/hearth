import Markdown, { type Components } from "react-markdown";

import { cn } from "@/lib/utils";

const SAFE_ELEMENTS = [
  "p",
  "strong",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "hr",
  "br",
] as const;

const components: Components = {
  h1: ({ children }) => (
    <h3 className="mt-4 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-4 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 text-base font-semibold first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>
  ),
  h6: ({ children }) => (
    <h4 className="mt-3 font-semibold first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="mt-3 whitespace-pre-wrap first:mt-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  ul: ({ children }) => (
    <ul className="mt-3 list-disc space-y-1 pl-5 first:mt-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1 pl-5 first:mt-0">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mt-3 border-l-2 border-primary/30 pl-3 text-muted-foreground first:mt-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs first:mt-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-4 border-primary/15" />,
};

interface MarkdownTextProps {
  children: string;
  className?: string;
}

export function MarkdownText({ children, className }: MarkdownTextProps) {
  return (
    <div className={cn("text-sm leading-relaxed", className)}>
      <Markdown
        allowedElements={SAFE_ELEMENTS}
        components={components}
        skipHtml
        unwrapDisallowed
      >
        {children}
      </Markdown>
    </div>
  );
}
