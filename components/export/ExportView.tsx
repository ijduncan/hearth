"use client";

import { useState, useMemo, useCallback } from "react";
import { subDays, format, differenceInDays } from "date-fns";
import { Loader2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MoodChart } from "@/components/insights/MoodChart";
import { YearHeatmap } from "@/components/insights/YearHeatmap";
import { DateRangePicker } from "./DateRangePicker";
import { MoodOverview } from "./MoodOverview";
import { TagBreakdown } from "./TagBreakdown";
import { PeriodHeatmap } from "./PeriodHeatmap";
import { TherapistSummary } from "./TherapistSummary";
import { getMoodLabel } from "@/lib/types";
import type { Entry } from "@/lib/types";

interface ExportViewProps {
  entries: Entry[];
  displayName: string;
}

export function ExportView({ entries, displayName }: ExportViewProps) {
  const [dateRange, setDateRange] = useState({
    from: subDays(new Date(), 14),
    to: new Date(),
  });
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");

  const filteredEntries = useMemo(
    () => entries.filter((e) => e.entry_date >= fromStr && e.entry_date <= toStr),
    [entries, fromStr, toStr]
  );

  // Reset AI summary when date range changes
  const handleDateChange = useCallback((range: { from: Date; to: Date }) => {
    setDateRange(range);
    setAiSummary(null);
    setError(null);
  }, []);

  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/therapist-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate: fromStr, endDate: toStr }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSummary(data.summary);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed (${res.status})`);
      }
    } catch (e) {
      setError("Network error — please try again");
    }
    setGenerating(false);
  };

  const handleCopy = async () => {
    const text = buildTextReport(filteredEntries, dateRange, aiSummary, displayName);
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={dateRange} onChange={handleDateChange} />
        <Button onClick={handleGenerate} disabled={generating || filteredEntries.length === 0}>
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Generating...
            </>
          ) : (
            "Generate Report"
          )}
        </Button>
      </div>

      {filteredEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No entries in this date range.
        </p>
      ) : (
        <>
          {/* Mood Overview */}
          <MoodOverview entries={filteredEntries} from={dateRange.from} to={dateRange.to} />

          {/* Period Mood Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Mood trend</CardTitle>
            </CardHeader>
            <CardContent>
              <MoodChart entries={filteredEntries} />
            </CardContent>
          </Card>

          {/* Period Heatmap */}
          <PeriodHeatmap entries={filteredEntries} from={dateRange.from} to={dateRange.to} />

          {/* Year Heatmap */}
          <YearHeatmap entries={entries} />

          {/* Tag Breakdown */}
          <TagBreakdown entries={filteredEntries} />

          {/* Therapist Summary */}
          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}
          {aiSummary && <TherapistSummary summary={aiSummary} />}

          {/* Copy Button */}
          {aiSummary && (
            <Button
              onClick={handleCopy}
              variant="outline"
              className="w-full"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Report
                </>
              )}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function buildTextReport(
  entries: Entry[],
  dateRange: { from: Date; to: Date },
  aiSummary: string | null,
  displayName: string
): string {
  const scored = entries.filter((e) => e.mood_score != null);
  const totalDays = differenceInDays(dateRange.to, dateRange.from) + 1;
  const consistency = totalDays > 0 ? Math.round((entries.length / totalDays) * 100) : 0;

  const lines: string[] = [];
  lines.push("HEARTH JOURNAL REPORT");
  lines.push(`Client: ${displayName}`);
  lines.push(`Period: ${format(dateRange.from, "MMM d, yyyy")} – ${format(dateRange.to, "MMM d, yyyy")}`);
  lines.push(`Generated: ${format(new Date(), "MMM d, yyyy")}`);
  lines.push("");

  // Mood overview
  lines.push("--- MOOD OVERVIEW ---");
  lines.push(`Entries: ${entries.length} of ${totalDays} days (${consistency}%)`);
  if (scored.length > 0) {
    const scores = scored.map((e) => e.mood_score!);
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const lowest = scored.reduce((a, b) => (a.mood_score! < b.mood_score! ? a : b));
    const highest = scored.reduce((a, b) => (a.mood_score! > b.mood_score! ? a : b));
    lines.push(`Average Mood: ${avg}/10 (${getMoodLabel(avg)})`);
    lines.push(`Range: ${min} – ${max}`);
    lines.push(`Lowest: ${format(new Date(lowest.entry_date + "T00:00:00"), "MMM d")} (${min}/10)`);
    lines.push(`Highest: ${format(new Date(highest.entry_date + "T00:00:00"), "MMM d")} (${max}/10)`);
  }
  lines.push("");

  // Mood by day
  lines.push("--- MOOD BY DAY ---");
  for (const e of entries) {
    if (e.mood_score != null) {
      const tags = e.mood_tags?.length ? ` [${e.mood_tags.join(", ")}]` : "";
      lines.push(`${format(new Date(e.entry_date + "T00:00:00"), "MMM d")}: ${e.mood_score}/10 (${e.mood_label})${tags}`);
    }
  }
  lines.push("");

  // Tag breakdown
  const tagMoodMap: Record<string, { total: number; count: number }> = {};
  entries.forEach((e) => {
    (e.mood_tags || []).forEach((tag) => {
      if (!tagMoodMap[tag]) tagMoodMap[tag] = { total: 0, count: 0 };
      tagMoodMap[tag].total += e.mood_score || 0;
      tagMoodMap[tag].count += 1;
    });
  });
  const tagStats = Object.entries(tagMoodMap)
    .map(([tag, { total, count }]) => ({ tag, avg: Math.round((total / count) * 10) / 10, count }))
    .sort((a, b) => b.count - a.count);

  if (tagStats.length > 0) {
    lines.push("--- TAG BREAKDOWN ---");
    for (const { tag, avg, count } of tagStats) {
      lines.push(`${tag}: ${count}x, avg ${avg}/10`);
    }
    lines.push("");
  }

  // AI summary
  if (aiSummary) {
    lines.push("--- THERAPIST SUMMARY ---");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("---");
  lines.push("Generated by Hearth");

  return lines.join("\n");
}
