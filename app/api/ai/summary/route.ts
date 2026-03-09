import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWeeklySummary } from "@/lib/claude";
import { startOfWeek, endOfWeek, format } from "date-fns";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const targetDate = body.date ? new Date(body.date) : new Date();

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
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate summary" },
      { status: 500 }
    );
  }
}
