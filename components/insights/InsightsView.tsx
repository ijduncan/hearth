"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MoodChart } from "./MoodChart";
import { MoodHeatmap } from "./MoodHeatmap";
import { YearHeatmap } from "./YearHeatmap";
import { MoodPatterns } from "./MoodPatterns";
import { WeeklySummary } from "./WeeklySummary";
import { MonthlySummary } from "./MonthlySummary";
import { StreakBadge } from "./StreakBadge";
import type { Entry, WeeklySummary as WeeklySummaryType, MonthlySummary as MonthlySummaryType } from "@/lib/types";
import { subDays } from "date-fns";

interface InsightsViewProps {
  entries: Entry[];
  streakCount: number;
  weeklySummary: WeeklySummaryType | null;
  monthlySummary: MonthlySummaryType | null;
}

export function InsightsView({
  entries,
  streakCount,
  weeklySummary,
  monthlySummary,
}: InsightsViewProps) {
  // Stats calculations
  const now = new Date();
  const sevenDaysAgo = subDays(now, 7).toISOString().split("T")[0];
  const fourteenDaysAgo = subDays(now, 14).toISOString().split("T")[0];

  const thisWeekEntries = entries.filter((e) => e.entry_date >= sevenDaysAgo);
  const lastWeekEntries = entries.filter(
    (e) => e.entry_date >= fourteenDaysAgo && e.entry_date < sevenDaysAgo
  );

  const avgMoodThisWeek =
    thisWeekEntries.length > 0
      ? thisWeekEntries.reduce((sum, e) => sum + (e.mood_score || 0), 0) /
        thisWeekEntries.length
      : 0;

  const avgMoodLastWeek =
    lastWeekEntries.length > 0
      ? lastWeekEntries.reduce((sum, e) => sum + (e.mood_score || 0), 0) /
        lastWeekEntries.length
      : 0;

  const moodDelta = avgMoodThisWeek - avgMoodLastWeek;

  // Tag stats
  const tagMoodMap: Record<string, { total: number; count: number }> = {};
  entries.forEach((e) => {
    (e.mood_tags || []).forEach((tag) => {
      if (!tagMoodMap[tag]) tagMoodMap[tag] = { total: 0, count: 0 };
      tagMoodMap[tag].total += e.mood_score || 0;
      tagMoodMap[tag].count += 1;
    });
  });

  const tagStats = Object.entries(tagMoodMap)
    .map(([tag, { total, count }]) => ({
      tag,
      avgMood: Math.round((total / count) * 10) / 10,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const thirtyDaysAgo = subDays(now, 30).toISOString().split("T")[0];
  const recentEntries = entries.filter((e) => e.entry_date >= thirtyDaysAgo);

  // Longest entry
  const longestEntry = entries.reduce(
    (max, e) => ((e.word_count || 0) > max ? e.word_count || 0 : max),
    0
  );

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <StreakBadge count={streakCount} />
            {streakCount === 0 && (
              <p className="text-sm text-muted-foreground">No streak yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {avgMoodThisWeek > 0 ? avgMoodThisWeek.toFixed(1) : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Avg mood this week
              {avgMoodLastWeek > 0 && moodDelta !== 0 && (
                <span className={moodDelta > 0 ? " text-mood-high" : " text-mood-low"}>
                  {" "}
                  {moodDelta > 0 ? "↑" : "↓"}
                  {Math.abs(moodDelta).toFixed(1)}
                </span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {recentEntries.length}
            </p>
            <p className="text-xs text-muted-foreground">Entries (30 days)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4 text-center">
            <p className="text-2xl font-semibold tabular-nums">
              {longestEntry > 0 ? longestEntry : "—"}
            </p>
            <p className="text-xs text-muted-foreground">Longest entry (words)</p>
          </CardContent>
        </Card>
      </div>

      {/* Mood chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Mood over 30 days</CardTitle>
        </CardHeader>
        <CardContent>
          <MoodChart entries={recentEntries} />
        </CardContent>
      </Card>

      {/* Mood heatmap */}
      <MoodHeatmap entries={entries} />

      {/* Year heatmap */}
      <YearHeatmap entries={entries} />

      {/* Mood patterns */}
      <MoodPatterns entries={entries} />

      {/* Weekly summary */}
      <WeeklySummary summary={weeklySummary} />

      {/* Monthly summary */}
      <MonthlySummary summary={monthlySummary} />

      {/* Tag heatmap */}
      {tagStats.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mood by tag</CardTitle>
            <p className="text-xs text-muted-foreground">Average mood score when a tag is used</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tagStats.map(({ tag, avgMood, count }) => (
                <div
                  key={tag}
                  className="flex items-center justify-between text-sm"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {count}x
                    </span>
                  </div>
                  <span className="tabular-nums font-medium">
                    {avgMood}/10
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
