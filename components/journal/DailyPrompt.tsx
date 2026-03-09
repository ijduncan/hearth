"use client";

import type { Prompt } from "@/lib/types";

interface DailyPromptProps {
  prompt: Prompt;
}

export function DailyPrompt({ prompt }: DailyPromptProps) {
  return (
    <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
      <p className="text-xs font-medium text-primary/60 uppercase tracking-wider mb-1">
        {prompt.category.replace(/_/g, " ")}
      </p>
      <p className="font-serif text-lg leading-relaxed">{prompt.text}</p>
    </div>
  );
}
