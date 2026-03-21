"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { subDays, format, differenceInDays } from "date-fns";
import { Loader2, Copy, Check } from "lucide-react";
import { toPng } from "html-to-image";
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
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refs for chart sections to capture as images
  const moodChartRef = useRef<HTMLDivElement>(null);
  const periodHeatmapRef = useRef<HTMLDivElement>(null);
  const yearHeatmapRef = useRef<HTMLDivElement>(null);

  const fromStr = format(dateRange.from, "yyyy-MM-dd");
  const toStr = format(dateRange.to, "yyyy-MM-dd");

  const filteredEntries = useMemo(
    () => entries.filter((e) => e.entry_date >= fromStr && e.entry_date <= toStr),
    [entries, fromStr, toStr]
  );

  const handleDateChange = useCallback((range: { from: Date; to: Date }) => {
    setDateRange(range);
    setAiSummary(null);
    setError(null);
  }, []);

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
    } catch {
      setError("Network error — please try again");
    }
    setGenerating(false);
  };

  const handleCopyReport = async () => {
    setCopying(true);
    try {
      // Capture charts as images
      const opts = { backgroundColor: "#0a0a0a", pixelRatio: 2 };
      const [moodChartImg, periodHeatmapImg, yearHeatmapImg] = await Promise.all([
        moodChartRef.current ? toPng(moodChartRef.current, opts) : null,
        periodHeatmapRef.current ? toPng(periodHeatmapRef.current, opts) : null,
        yearHeatmapRef.current ? toPng(yearHeatmapRef.current, opts) : null,
      ]);

      // Build HTML with embedded images + text
      const html = buildHtmlReport(
        filteredEntries,
        dateRange,
        aiSummary,
        displayName,
        { moodChartImg, periodHeatmapImg, yearHeatmapImg }
      );
      const text = buildTextReport(filteredEntries, dateRange, aiSummary, displayName);

      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);

      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback to text-only copy
      const text = buildTextReport(filteredEntries, dateRange, aiSummary, displayName);
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setCopying(false);
  };

  const copyButton = aiSummary ? (
    <Button
      onClick={handleCopyReport}
      variant="outline"
      disabled={copying}
    >
      {copying ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Preparing...
        </>
      ) : copied ? (
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
  ) : null;

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
        {copyButton}
        <span className="text-xs text-muted-foreground">
          {filteredEntries.length} entries found ({entries.length} total)
        </span>
      </div>

      {filteredEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No entries in this date range. Try widening the range.
        </p>
      ) : (
        <>
          {/* Mood Overview */}
          <MoodOverview entries={filteredEntries} from={dateRange.from} to={dateRange.to} />

          {/* Period Mood Chart — captured as image */}
          <div ref={moodChartRef}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Mood trend</CardTitle>
              </CardHeader>
              <CardContent>
                <MoodChart entries={filteredEntries} />
              </CardContent>
            </Card>
          </div>

          {/* Period Heatmap — captured as image */}
          <div ref={periodHeatmapRef}>
            <PeriodHeatmap entries={filteredEntries} from={dateRange.from} to={dateRange.to} />
          </div>

          {/* Year Heatmap — captured as image */}
          <div ref={yearHeatmapRef}>
            <YearHeatmap entries={entries} />
          </div>

          {/* Tag Breakdown */}
          <TagBreakdown entries={filteredEntries} />

          {/* Therapist Summary */}
          {error && (
            <p className="text-sm text-red-500 text-center">{error}</p>
          )}
          {aiSummary && <TherapistSummary summary={aiSummary} />}

          {/* Copy Button (bottom) */}
          {copyButton}
        </>
      )}
    </div>
  );
}

function buildHtmlReport(
  entries: Entry[],
  dateRange: { from: Date; to: Date },
  aiSummary: string | null,
  displayName: string,
  images: {
    moodChartImg: string | null;
    periodHeatmapImg: string | null;
    yearHeatmapImg: string | null;
  }
): string {
  const scored = entries.filter((e) => e.mood_score != null);
  const totalDays = differenceInDays(dateRange.to, dateRange.from) + 1;
  const consistency = totalDays > 0 ? Math.round((entries.length / totalDays) * 100) : 0;

  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 4px">Hearth Journal Report</h2>`);
  parts.push(`<p style="color:#888;margin:0 0 16px">${displayName} &middot; ${format(dateRange.from, "MMM d")} – ${format(dateRange.to, "MMM d, yyyy")}</p>`);

  // Mood overview
  parts.push(`<h3>Mood Overview</h3>`);
  parts.push(`<p>Entries: ${entries.length} of ${totalDays} days (${consistency}%)</p>`);
  if (scored.length > 0) {
    const scores = scored.map((e) => e.mood_score!);
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const lowest = scored.reduce((a, b) => (a.mood_score! < b.mood_score! ? a : b));
    const highest = scored.reduce((a, b) => (a.mood_score! > b.mood_score! ? a : b));
    parts.push(`<p>Average Mood: ${avg}/10 (${getMoodLabel(avg)})<br>`);
    parts.push(`Range: ${min} – ${max}<br>`);
    parts.push(`Lowest: ${format(new Date(lowest.entry_date + "T00:00:00"), "MMM d")} (${min}/10)<br>`);
    parts.push(`Highest: ${format(new Date(highest.entry_date + "T00:00:00"), "MMM d")} (${max}/10)</p>`);
  }

  // Chart images
  if (images.moodChartImg) {
    parts.push(`<h3>Mood Trend</h3>`);
    parts.push(`<img src="${images.moodChartImg}" style="max-width:100%;border-radius:8px" />`);
  }
  if (images.periodHeatmapImg) {
    parts.push(`<h3>Period Heatmap</h3>`);
    parts.push(`<img src="${images.periodHeatmapImg}" style="max-width:100%;border-radius:8px" />`);
  }
  if (images.yearHeatmapImg) {
    parts.push(`<h3>Year Heatmap</h3>`);
    parts.push(`<img src="${images.yearHeatmapImg}" style="max-width:100%;border-radius:8px" />`);
  }

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
    parts.push(`<h3>Tag Breakdown</h3>`);
    parts.push(`<table style="border-collapse:collapse;font-size:14px">`);
    parts.push(`<tr><th style="text-align:left;padding:2px 12px 2px 0">Tag</th><th style="text-align:left;padding:2px 12px 2px 0">Count</th><th style="text-align:left">Avg Mood</th></tr>`);
    for (const { tag, avg, count } of tagStats) {
      parts.push(`<tr><td style="padding:2px 12px 2px 0">${tag}</td><td style="padding:2px 12px 2px 0">${count}x</td><td>${avg}/10</td></tr>`);
    }
    parts.push(`</table>`);
  }

  // Mood by day
  parts.push(`<h3>Mood by Day</h3>`);
  parts.push(`<table style="border-collapse:collapse;font-size:14px">`);
  for (const e of entries) {
    if (e.mood_score != null) {
      const tags = e.mood_tags?.length ? ` (${e.mood_tags.join(", ")})` : "";
      parts.push(`<tr><td style="padding:1px 12px 1px 0">${format(new Date(e.entry_date + "T00:00:00"), "MMM d")}</td><td style="padding:1px 12px 1px 0">${e.mood_score}/10</td><td style="color:#888">${e.mood_label}${tags}</td></tr>`);
    }
  }
  parts.push(`</table>`);

  // AI summary
  if (aiSummary) {
    parts.push(`<h3>Therapist Summary</h3>`);
    const paragraphs = aiSummary.split("\n\n").filter(Boolean);
    for (const p of paragraphs) {
      parts.push(`<p>${p.replace(/\n/g, "<br>")}</p>`);
    }
  }

  parts.push(`<hr><p style="color:#888;font-size:12px">Generated by Hearth</p>`);

  return parts.join("\n");
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

  lines.push("--- MOOD BY DAY ---");
  for (const e of entries) {
    if (e.mood_score != null) {
      const tags = e.mood_tags?.length ? ` [${e.mood_tags.join(", ")}]` : "";
      lines.push(`${format(new Date(e.entry_date + "T00:00:00"), "MMM d")}: ${e.mood_score}/10 (${e.mood_label})${tags}`);
    }
  }
  lines.push("");

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

  if (aiSummary) {
    lines.push("--- THERAPIST SUMMARY ---");
    lines.push(aiSummary);
    lines.push("");
  }

  lines.push("---");
  lines.push("Generated by Hearth");

  return lines.join("\n");
}
