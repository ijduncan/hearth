"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, CalendarDays, Tag } from "lucide-react";
import { detectAllPatterns, type MoodPattern } from "@/lib/patterns";
import type { Entry } from "@/lib/types";

interface MoodPatternsProps {
  entries: Entry[];
}

function PatternIcon({ type }: { type: MoodPattern["type"] }) {
  switch (type) {
    case "day_of_week":
      return <CalendarDays className="h-4 w-4 text-primary/60" />;
    case "tag_correlation":
      return <Tag className="h-4 w-4 text-primary/60" />;
    case "trend":
      return <TrendingUp className="h-4 w-4 text-primary/60" />;
  }
}

function PatternTitle({ type }: { type: MoodPattern["type"] }) {
  switch (type) {
    case "day_of_week":
      return "Day patterns";
    case "tag_correlation":
      return "Tag correlations";
    case "trend":
      return "Mood trend";
  }
}

export function MoodPatterns({ entries }: MoodPatternsProps) {
  const patterns = useMemo(() => detectAllPatterns(entries), [entries]);

  if (patterns.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Patterns</CardTitle>
        <p className="text-xs text-muted-foreground">
          Based on your last {entries.length} entries
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {patterns.map((pattern, i) => (
            <motion.div
              key={pattern.type}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.1 }}
              className="rounded-lg border border-border p-3 space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <PatternIcon type={pattern.type} />
                <span className="text-sm font-medium">
                  <PatternTitle type={pattern.type} />
                </span>
              </div>
              {pattern.insights.map((insight, j) => (
                <p key={j} className="text-sm text-muted-foreground pl-6">
                  {insight}
                </p>
              ))}
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
