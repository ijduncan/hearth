"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Entry } from "@/lib/types";

interface TagBreakdownProps {
  entries: Entry[];
}

export function TagBreakdown({ entries }: TagBreakdownProps) {
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

  if (tagStats.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Tag Breakdown</CardTitle>
        <p className="text-xs text-muted-foreground">Frequency and average mood per tag</p>
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
  );
}
