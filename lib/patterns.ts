import { getDay } from "date-fns";
import type { Entry } from "./types";

export interface DayOfWeekPattern {
  type: "day_of_week";
  data: Record<string, { avg: number; count: number }>;
  insights: string[];
}

export interface TagCorrelationPattern {
  type: "tag_correlation";
  data: { tag: string; avg: number; count: number }[];
  insights: string[];
}

export interface TrendPattern {
  type: "trend";
  data: { direction: "up" | "down" | "stable"; slope: number; periodDays: number };
  insights: string[];
}

export type MoodPattern = DayOfWeekPattern | TagCorrelationPattern | TrendPattern;

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function detectDayOfWeekPattern(entries: Entry[]): DayOfWeekPattern | null {
  if (entries.length < 14) return null; // need at least 2 weeks

  const byDay: Record<number, number[]> = {};
  for (const e of entries) {
    if (e.mood_score == null) continue;
    const day = getDay(new Date(e.entry_date + "T00:00:00"));
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(e.mood_score);
  }

  const overallAvg =
    entries.reduce((s, e) => s + (e.mood_score || 0), 0) /
    entries.filter((e) => e.mood_score != null).length;

  const data: Record<string, { avg: number; count: number }> = {};
  const insights: string[] = [];

  for (let d = 0; d < 7; d++) {
    const scores = byDay[d] || [];
    if (scores.length === 0) continue;
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    data[DAY_NAMES[d]] = { avg, count: scores.length };

    const delta = avg - overallAvg;
    if (scores.length >= 2 && Math.abs(delta) >= 1.5) {
      if (delta > 0) {
        insights.push(`${DAY_NAMES[d]}s tend to be your best days (${avg}/10 avg)`);
      } else {
        insights.push(`${DAY_NAMES[d]}s tend to be tougher for you (${avg}/10 avg)`);
      }
    }
  }

  if (insights.length === 0) return null;
  return { type: "day_of_week", data, insights };
}

export function detectTagCorrelations(entries: Entry[]): TagCorrelationPattern | null {
  const tagScores: Record<string, number[]> = {};

  for (const e of entries) {
    if (e.mood_score == null || !e.mood_tags) continue;
    for (const tag of e.mood_tags) {
      if (!tagScores[tag]) tagScores[tag] = [];
      tagScores[tag].push(e.mood_score);
    }
  }

  const overallAvg =
    entries.reduce((s, e) => s + (e.mood_score || 0), 0) /
    entries.filter((e) => e.mood_score != null).length;

  const data: { tag: string; avg: number; count: number }[] = [];
  const insights: string[] = [];

  for (const [tag, scores] of Object.entries(tagScores)) {
    if (scores.length < 3) continue;
    const avg = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10;
    data.push({ tag, avg, count: scores.length });

    const delta = avg - overallAvg;
    if (Math.abs(delta) >= 1.0) {
      if (delta > 0) {
        insights.push(`When you tag "${tag}", your mood averages ${avg}/10 — above your usual`);
      } else {
        insights.push(`Days tagged "${tag}" average ${avg}/10 — below your usual`);
      }
    }
  }

  data.sort((a, b) => b.count - a.count);
  if (insights.length === 0) return null;
  return { type: "tag_correlation", data, insights };
}

export function detectTrend(entries: Entry[]): TrendPattern | null {
  const scored = entries
    .filter((e) => e.mood_score != null)
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));

  if (scored.length < 7) return null;

  // Simple linear regression over the most recent 21 days of entries
  const recent = scored.slice(-21);
  const n = recent.length;
  const xs = recent.map((_, i) => i);
  const ys = recent.map((e) => e.mood_score!);

  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }

  const slope = den === 0 ? 0 : Math.round((num / den) * 100) / 100;
  const periodDays = n;

  // Slope per entry; threshold ~0.1 means roughly 1 point over 10 entries
  const insights: string[] = [];
  let direction: "up" | "down" | "stable" = "stable";

  if (slope >= 0.1) {
    direction = "up";
    insights.push(`Your mood has been trending upward over the last ${periodDays} entries`);
  } else if (slope <= -0.1) {
    direction = "down";
    insights.push(`Your mood has been trending downward over the last ${periodDays} entries`);
  }

  if (insights.length === 0) return null;
  return { type: "trend", data: { direction, slope, periodDays }, insights };
}

export function detectAllPatterns(entries: Entry[]): MoodPattern[] {
  const patterns: MoodPattern[] = [];

  const dow = detectDayOfWeekPattern(entries);
  if (dow) patterns.push(dow);

  const tags = detectTagCorrelations(entries);
  if (tags) patterns.push(tags);

  const trend = detectTrend(entries);
  if (trend) patterns.push(trend);

  return patterns;
}
