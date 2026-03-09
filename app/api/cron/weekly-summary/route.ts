import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateWeeklySummary } from "@/lib/claude";
import { startOfWeek, endOfWeek, format } from "date-fns";

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Use service role key for cron jobs
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    }
  );

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // Get all profiles
  const { data: profiles } = await supabase.from("profiles").select("*");

  if (!profiles) {
    return NextResponse.json({ error: "No profiles found" }, { status: 404 });
  }

  const results = [];

  for (const profile of profiles) {
    // Check if summary already exists
    const { data: existing } = await supabase
      .from("weekly_summaries")
      .select("id")
      .eq("user_id", profile.id)
      .eq("week_start", weekStartStr)
      .single();

    if (existing) {
      results.push({ user: profile.display_name, status: "already_exists" });
      continue;
    }

    // Get entries for the week
    const { data: entries } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", profile.id)
      .gte("entry_date", weekStartStr)
      .lte("entry_date", weekEndStr)
      .order("entry_date");

    if (!entries || entries.length === 0) {
      results.push({ user: profile.display_name, status: "no_entries" });
      continue;
    }

    try {
      const summaryText = await generateWeeklySummary(
        entries,
        profile.display_name
      );

      const avgMood =
        entries.reduce((sum, e) => sum + (e.mood_score || 0), 0) /
        entries.length;

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

      await supabase.from("weekly_summaries").upsert(
        {
          user_id: profile.id,
          week_start: weekStartStr,
          week_end: weekEndStr,
          summary_text: summaryText,
          avg_mood: Math.round(avgMood * 10) / 10,
          dominant_tags: dominantTags,
        },
        { onConflict: "user_id,week_start" }
      );

      results.push({ user: profile.display_name, status: "generated" });
    } catch {
      results.push({ user: profile.display_name, status: "error" });
    }
  }

  return NextResponse.json({ results });
}
