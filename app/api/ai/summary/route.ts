import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWeeklySummary } from "@/lib/claude";
import { startOfWeek, endOfWeek, format } from "date-fns";
import { checkRateLimit } from "@/lib/security";
import { isValidDateString, parseJsonObject } from "@/lib/validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(supabase, "weekly-summary", 5, 15 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many summary requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = parseJsonObject(await request.json());
  } catch {
    // An empty object is allowed.
  }
  if (body?.date != null && !isValidDateString(body.date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const targetDate = body?.date
    ? new Date(`${body.date as string}T00:00:00`)
    : new Date();

  const weekStart = startOfWeek(targetDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(targetDate, { weekStartsOn: 1 });

  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // Check if summary already exists
  const { data: existing } = await supabase
    .from("weekly_summaries")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_start", weekStartStr)
    .single();

  if (existing) {
    return NextResponse.json(existing);
  }

  // Get entries for the week
  const { data: entries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .gte("entry_date", weekStartStr)
    .lte("entry_date", weekEndStr)
    .order("entry_date");

  if (!entries || entries.length === 0) {
    return NextResponse.json(
      { error: "No entries found for this week" },
      { status: 404 }
    );
  }

  // Get profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  try {
    const summaryText = await generateWeeklySummary(
      entries,
      profile?.display_name || "friend"
    );

    const avgMood =
      entries.reduce((sum, e) => sum + (e.mood_score || 0), 0) / entries.length;

    const tagCounts: Record<string, number> = {};
    entries.forEach((e) => {
      (e.mood_tags || []).forEach((tag: string) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });
    const dominantTags = Object.entries(tagCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);

    const { data: summary, error } = await supabase
      .from("weekly_summaries")
      .upsert(
        {
          user_id: user.id,
          week_start: weekStartStr,
          week_end: weekEndStr,
          summary_text: summaryText,
          avg_mood: Math.round(avgMood * 10) / 10,
          dominant_tags: dominantTags,
        },
        { onConflict: "user_id,week_start" }
      )
      .select()
      .single();

    if (error) {
      console.error("Failed to save weekly summary:", error.message);
      return NextResponse.json({ error: "Failed to save summary" }, { status: 500 });
    }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}
