"use client";

import { AnimatePresence, motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import type { Prompt } from "@/lib/types";

interface DailyPromptProps {
  prompt: Prompt;
  onSwap?: () => void;
  swapCount?: number;
  swapping?: boolean;
}

export function DailyPrompt({
  prompt,
  onSwap,
  swapCount = 0,
  swapping = false,
}: DailyPromptProps) {
  const canSwap = onSwap && swapCount < 3;

  return (
    <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
      <p className="text-xs font-medium text-primary/60 uppercase tracking-wider mb-1">
        {prompt.category.replace(/_/g, " ")}
      </p>
      <AnimatePresence mode="wait">
        <motion.p
          key={prompt.text}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.2 }}
          className="font-serif text-lg leading-relaxed"
        >
          {prompt.text}
        </motion.p>
      </AnimatePresence>
      {canSwap && (
        <button
          type="button"
          onClick={onSwap}
          disabled={swapping}
          className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3 w-3 ${swapping ? "animate-spin" : ""}`}
          />
          {swapping ? "Finding another..." : "Try a different question"}
        </button>
      )}
    </div>
  );
}
