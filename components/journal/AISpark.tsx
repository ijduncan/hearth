"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { MarkdownText } from "@/components/ai/MarkdownText";
import { Card, CardContent } from "@/components/ui/card";

interface AISparkProps {
  acknowledgment: string;
  streakCount: number;
}

export function AISpark({ acknowledgment, streakCount }: AISparkProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.5, duration: 0.6, ease: "easeOut" }}
    >
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wider">
              You were heard
            </span>
          </div>
          <MarkdownText className="font-serif">
            {acknowledgment}
          </MarkdownText>
          <div className="flex items-center justify-between pt-2 border-t border-primary/10">
            <p className="text-xs text-muted-foreground">
              Entry saved
            </p>
            {streakCount > 0 && (
              <p className="text-xs text-muted-foreground">
                🔥 {streakCount} day streak
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
