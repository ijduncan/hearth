"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { Entry } from "@/lib/types";
import { getMoodColor } from "@/lib/types";

interface MoodChartProps {
  entries: Entry[];
}

export function MoodChart({ entries }: MoodChartProps) {
  const data = entries
    .filter((e) => e.mood_score !== null)
    .map((e) => ({
      date: e.entry_date,
      label: format(parseISO(e.entry_date), "MMM d"),
      mood: e.mood_score,
      color: getMoodColor(e.mood_score!),
    }));

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No mood data yet. Start journaling to see your trends.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          domain={[1, 10]}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          width={30}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            fontSize: "12px",
          }}
          formatter={(value) => [`${value}/10`, "Mood"]}
        />
        <defs>
          <linearGradient id="moodGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22C55E" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
        </defs>
        <Line
          type="monotone"
          dataKey="mood"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 4, fill: "var(--primary)" }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
