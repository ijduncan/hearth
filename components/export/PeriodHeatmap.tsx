"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMoodColor } from "@/lib/types";
import type { Entry } from "@/lib/types";
import { startOfWeek, addDays, format, differenceInWeeks } from "date-fns";

interface PeriodHeatmapProps {
  entries: Entry[];
  from: Date;
  to: Date;
}

export function PeriodHeatmap({ entries, from, to }: PeriodHeatmapProps) {
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const gridStart = startOfWeek(from, { weekStartsOn: 1 });
  const numWeeks = Math.max(differenceInWeeks(to, gridStart) + 1, 1);

  const moodByDate: Record<string, number> = {};
  for (const e of entries) {
    if (e.mood_score != null) {
      moodByDate[e.entry_date] = e.mood_score;
    }
  }

  const weeks: { dateStr: string; score: number | null; isFuture: boolean }[][] = [];
  let current = gridStart;

  for (let w = 0; w < numWeeks; w++) {
    const week: typeof weeks[0] = [];
    for (let d = 0; d < 7; d++) {
      const dateStr = format(current, "yyyy-MM-dd");
      const isFuture = dateStr > todayStr;
      week.push({
        dateStr,
        score: isFuture ? null : (moodByDate[dateStr] ?? null),
        isFuture,
      });
      current = addDays(current, 1);
    }
    weeks.push(week);
  }

  const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Period heatmap</CardTitle>
        <p className="text-xs text-muted-foreground">
          {format(from, "MMM d")} – {format(to, "MMM d, yyyy")}
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {dayLabels.map((label, i) => (
            <div key={i} className="text-[10px] text-muted-foreground text-center">
              {label}
            </div>
          ))}
        </div>
        <div className="grid gap-1.5">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-cols-7 gap-1.5">
              {week.map(({ dateStr, score, isFuture }) => (
                <div
                  key={dateStr}
                  className="aspect-[1.6] rounded-md border border-border"
                  style={
                    score != null
                      ? {
                          backgroundColor: getMoodColor(score),
                          opacity: 0.4 + (score / 10) * 0.6,
                        }
                      : isFuture
                        ? { opacity: 0.3 }
                        : {}
                  }
                  title={
                    score != null
                      ? `${format(new Date(dateStr + "T00:00:00"), "MMM d")}: ${score}/10`
                      : isFuture
                        ? format(new Date(dateStr + "T00:00:00"), "MMM d")
                        : `${format(new Date(dateStr + "T00:00:00"), "MMM d")}: no entry`
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
