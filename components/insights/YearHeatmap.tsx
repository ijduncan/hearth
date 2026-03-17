"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getMoodColor } from "@/lib/types";
import type { Entry } from "@/lib/types";
import { subDays, startOfWeek, addDays, format, getMonth } from "date-fns";

interface YearHeatmapProps {
  entries: Entry[];
}

export function YearHeatmap({ entries }: YearHeatmapProps) {
  const today = new Date();
  const todayStr = format(today, "yyyy-MM-dd");

  // Start 364 days ago, snap to Monday
  const rawStart = subDays(today, 364);
  const gridStart = startOfWeek(rawStart, { weekStartsOn: 1 });

  // Build date->score map
  const moodByDate: Record<string, number> = {};
  for (const e of entries) {
    if (e.mood_score != null) {
      moodByDate[e.entry_date] = e.mood_score;
    }
  }

  // Build weeks (columns) with 7 days each (rows: Mon=0 ... Sun=6)
  const weeks: { dateStr: string; score: number | null; isFuture: boolean }[][] = [];
  let current = gridStart;

  while (current <= today) {
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

  // Month labels: find first week where a new month starts
  const monthLabels: { col: number; label: string }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks.length; w++) {
    // Check the Monday (first day) of each week
    const dateStr = weeks[w][0].dateStr;
    const month = getMonth(new Date(dateStr + "T00:00:00"));
    if (month !== lastMonth) {
      monthLabels.push({
        col: w,
        label: format(new Date(dateStr + "T00:00:00"), "MMM"),
      });
      lastMonth = month;
    }
  }

  const dayLabels = ["M", "", "W", "", "F", "", ""];
  const cellSize = 13;
  const cellGap = 2;
  const labelWidth = 20;
  const headerHeight = 16;
  const totalWidth = labelWidth + weeks.length * (cellSize + cellGap);
  const totalHeight = headerHeight + 7 * (cellSize + cellGap);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Year in mood</CardTitle>
        <p className="text-xs text-muted-foreground">Last 365 days</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto -mx-2 px-2">
          <svg
            width={totalWidth}
            height={totalHeight}
            className="block"
          >
            {/* Month labels */}
            {monthLabels.map(({ col, label }) => (
              <text
                key={`month-${col}`}
                x={labelWidth + col * (cellSize + cellGap)}
                y={11}
                className="fill-muted-foreground"
                fontSize={10}
              >
                {label}
              </text>
            ))}

            {/* Day-of-week labels */}
            {dayLabels.map((label, i) =>
              label ? (
                <text
                  key={`day-${i}`}
                  x={0}
                  y={headerHeight + i * (cellSize + cellGap) + cellSize - 2}
                  className="fill-muted-foreground"
                  fontSize={10}
                >
                  {label}
                </text>
              ) : null
            )}

            {/* Cells */}
            {weeks.map((week, wi) =>
              week.map(({ dateStr, score, isFuture }, di) => (
                <rect
                  key={dateStr}
                  x={labelWidth + wi * (cellSize + cellGap)}
                  y={headerHeight + di * (cellSize + cellGap)}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  className={
                    score == null
                      ? "fill-muted/30 stroke-border"
                      : "stroke-border"
                  }
                  style={
                    score != null
                      ? {
                          fill: getMoodColor(score),
                          opacity: 0.4 + (score / 10) * 0.6,
                        }
                      : isFuture
                        ? { opacity: 0.15 }
                        : {}
                  }
                  strokeWidth={0.5}
                >
                  <title>
                    {score != null
                      ? `${format(new Date(dateStr + "T00:00:00"), "EEE, MMM d")}: ${score}/10`
                      : isFuture
                        ? format(new Date(dateStr + "T00:00:00"), "EEE, MMM d")
                        : `${format(new Date(dateStr + "T00:00:00"), "EEE, MMM d")}: no entry`}
                  </title>
                </rect>
              ))
            )}
          </svg>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-3 text-[10px] text-muted-foreground">
          <span>Low</span>
          {[2, 4, 6, 8, 10].map((score) => (
            <div
              key={score}
              className="rounded-sm"
              style={{
                width: 10,
                height: 10,
                backgroundColor: getMoodColor(score),
                opacity: 0.4 + (score / 10) * 0.6,
              }}
            />
          ))}
          <span>High</span>
        </div>
      </CardContent>
    </Card>
  );
}
