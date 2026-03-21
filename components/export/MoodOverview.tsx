"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMoodLabel } from "@/lib/types";
import type { Entry } from "@/lib/types";
import { differenceInDays, format } from "date-fns";

interface MoodOverviewProps {
  entries: Entry[];
  from: Date;
  to: Date;
}

export function MoodOverview({ entries, from, to }: MoodOverviewProps) {
  const scored = entries.filter((e) => e.mood_score != null);
  const totalDays = differenceInDays(to, from) + 1;
  const consistency = totalDays > 0 ? Math.round((entries.length / totalDays) * 100) : 0;

  if (scored.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          No mood data for this period.
        </CardContent>
      </Card>
    );
  }

  const scores = scored.map((e) => e.mood_score!);
  const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const lowest = scored.reduce((a, b) => (a.mood_score! < b.mood_score! ? a : b));
  const highest = scored.reduce((a, b) => (a.mood_score! > b.mood_score! ? a : b));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Mood Overview</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Entries</p>
            <p className="font-semibold tabular-nums">
              {entries.length} of {totalDays} days ({consistency}%)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Average Mood</p>
            <p className="font-semibold tabular-nums">
              {avg}/10 ({getMoodLabel(avg)})
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Lowest</p>
            <p className="font-semibold tabular-nums">
              {format(new Date(lowest.entry_date + "T00:00:00"), "MMM d")} ({min}/10)
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Highest</p>
            <p className="font-semibold tabular-nums">
              {format(new Date(highest.entry_date + "T00:00:00"), "MMM d")} ({max}/10)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
