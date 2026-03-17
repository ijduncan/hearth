import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { generateMonthlySummary } from "@/lib/claude";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";

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

  // Generate for previous month
  const lastMonth = subMonths(new Date(), 1);
  const monthStart = startOfMonth(lastMonth);
  const monthEnd = endOfMonth(lastMonth);
  const monthStartStr = format(monthStart, "yyyy-MM-dd");
  const monthEndStr = format(monthEnd, "yyyy-MM-dd");

  // Get all profiles
  const { data: profiles } = await supabase.from("profiles").select("*");

  if (!profiles) {
    return NextResponse.json({ error: "No profiles found" }, { status: 404 });
  }

  const results = [];

  for (const profile of profiles) {
    // Check if summary already exists
    const { data: existing } = await supabase
      .from("monthly_summaries")
      .select("id")
      .eq("user_id", profile.id)
      .eq("month_start", monthStartStr)
      .single();

    if (existing) {
      results.push({ user: profile.display_name, status: "already_exists" });
      continue;
    }

    // Get entries for the month
    const { data: entries } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", profile.id)
      .gte("entry_date", monthStartStr)
      .lte("entry_date", monthEndStr)
      .order("entry_date");

    if (!entries || entries.length === 0) {
      results.push({ user: profile.display_name, status: "no_entries" });
      continue;
    }

    try {
      const summaryText = await generateMonthlySummary(
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

      await supabase.from("monthly_summaries").upsert(
        {
          user_id: profile.id,
          month_start: monthStartStr,
          month_end: monthEndStr,
          summary_text: summaryText,
          avg_mood: Math.round(avgMood * 10) / 10,
          dominant_tags: dominantTags,
          total_entries: entries.length,
        },
        { onConflict: "user_id,month_start" }
      );

      results.push({ user: profile.display_name, status: "generated" });
    } catch {
      results.push({ user: profile.display_name, status: "error" });
    }
  }

  return NextResponse.json({ results });
}
