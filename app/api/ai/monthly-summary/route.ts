import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMonthlySummary } from "@/lib/claude";
import { startOfMonth, endOfMonth, format, subMonths } from "date-fns";
import { checkRateLimit } from "@/lib/security";
import { isValidDateString, parseJsonObject } from "@/lib/validation";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(supabase, "monthly-summary", 5, 15 * 60);
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
  if (body?.regenerate != null && typeof body.regenerate !== "boolean") {
    return NextResponse.json({ error: "regenerate must be a boolean" }, { status: 400 });
  }
  // Default to previous month if no date provided
  const targetDate = body?.date
    ? new Date(`${body.date as string}T00:00:00`)
    : subMonths(new Date(), 1);

  const monthStart = startOfMonth(targetDate);
  const monthEnd = endOfMonth(targetDate);
  const monthStartStr = format(monthStart, "yyyy-MM-dd");
  const monthEndStr = format(monthEnd, "yyyy-MM-dd");

  // Check if summary already exists
  const { data: existing } = await supabase
    .from("monthly_summaries")
    .select("*")
    .eq("user_id", user.id)
    .eq("month_start", monthStartStr)
    .single();

  if (existing && !body?.regenerate) {
    return NextResponse.json(existing);
  }

  // Get entries for the month
  const { data: entries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .gte("entry_date", monthStartStr)
    .lte("entry_date", monthEndStr)
    .order("entry_date");

  if (!entries || entries.length === 0) {
    return NextResponse.json(
      { error: "No entries found for this month" },
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
    const summaryText = await generateMonthlySummary(
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
      .from("monthly_summaries")
      .upsert(
        {
          user_id: user.id,
          month_start: monthStartStr,
          month_end: monthEndStr,
          summary_text: summaryText,
          avg_mood: Math.round(avgMood * 10) / 10,
          dominant_tags: dominantTags,
          total_entries: entries.length,
        },
        { onConflict: "user_id,month_start" }
      )
      .select()
      .single();

    if (error) {
      console.error("Failed to save monthly summary:", error.message);
      return NextResponse.json({ error: "Failed to save monthly summary" }, { status: 500 });
    }

    return NextResponse.json(summary);
  } catch {
    return NextResponse.json(
      { error: "Failed to generate monthly summary" },
      { status: 500 }
    );
  }
}
