"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Entry } from "@/lib/types";
import { subDays, startOfWeek, addDays, format } from "date-fns";

interface MoodHeatmapProps {
  entries: Entry[];
}

function getMoodOpacity(score: number): number {
  // Map 1-10 score to opacity range 0.2-1.0
  return 0.2 + (score - 1) * (0.8 / 9);
}

export function MoodHeatmap({ entries }: MoodHeatmapProps) {
  const today = new Date();
  // Start from the Monday 4 weeks ago
  const fourWeeksAgo = subDays(today, 27);
  const gridStart = startOfWeek(fourWeeksAgo, { weekStartsOn: 1 });

  // Build a map of date -> mood_score
  const moodByDate: Record<string, number> = {};
  entries.forEach((e) => {
    if (e.mood_score != null) {
      moodByDate[e.entry_date] = e.mood_score;
    }
  });

  // Build 4 weeks of rows (each row = Mon-Sun)
  const weeks: { date: Date; dateStr: string; score: number | null }[][] = [];
  let current = gridStart;
  for (let w = 0; w < 4; w++) {
    const week: typeof weeks[0] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = format(current, "yyyy-MM-dd");
      const isFuture = current > today;
      week.push({
        date: current,
        dateStr,
        score: isFuture ? null : (moodByDate[dateStr] ?? null),
      });
      current = addDays(current, 1);
    }
    weeks.push(week);
  }

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mood heatmap</CardTitle>
        <p className="text-xs text-muted-foreground">Last 4 weeks</p>
      </CardHeader>
      <CardContent>
        {/* Day labels */}
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {dayLabels.map((label, i) => (
            <div
              key={i}
              className="text-[10px] text-muted-foreground text-center"
            >
              {label}
            </div>
          ))}
        </div>
        {/* Heatmap grid */}
        <div className="grid gap-1.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map(({ dateStr, score, date }) => {
                const isFuture = date > today;
                return (
                  <div
                    key={dateStr}
                    className="aspect-[1.6] rounded-md border border-border"
                    style={
                      score != null
                        ? {
                            backgroundColor: `oklch(0.55 0.12 145 / ${getMoodOpacity(score)})`,
                          }
                        : isFuture
                          ? { opacity: 0.3 }
                          : {}
                    }
                    title={
                      score != null
                        ? `${format(date, "MMM d")}: ${score}/10`
                        : isFuture
                          ? format(date, "MMM d")
                          : `${format(date, "MMM d")}: no entry`
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
