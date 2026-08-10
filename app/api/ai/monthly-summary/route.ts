import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateMonthlySummary, isOpenAIConfigured } from "@/lib/openai";
import { startOfMonth, endOfMonth, format, subMonths } from "date-fns";
import { checkRateLimit, readLimitedJson } from "@/lib/security";
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

  const parsedBody = await readLimitedJson(request, 1024);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.tooLarge ? "Request body too large" : "Invalid JSON body" },
      { status: parsedBody.tooLarge ? 413 : 400 }
    );
  }
  const body = parseJsonObject(parsedBody.value);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
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
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, ai_enabled")
    .eq("id", user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: "Failed to load AI settings" }, { status: 500 });
  }
  if (!profile.ai_enabled) {
    return NextResponse.json(
      { error: "AI generation is temporarily unavailable" },
      { status: 503 }
    );
  }
  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: "AI service is not configured" },
      { status: 503 }
    );
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Monthly summary service is not configured" },
      { status: 503 }
    );
  }

  const { data: claimToken, error: claimError } = await admin.rpc(
    "claim_summary_generation",
    {
      p_user_id: user.id,
      p_summary_kind: "monthly",
      p_period_start: monthStartStr,
    }
  );
  if (claimError) {
    console.error("Failed to claim monthly summary generation");
    return NextResponse.json(
      { error: "Failed to prepare monthly summary" },
      { status: 500 }
    );
  }
  if (typeof claimToken !== "string") {
    return NextResponse.json(
      { error: "Monthly summary generation is already in progress" },
      { status: 409, headers: { "Retry-After": "30" } }
    );
  }

  try {
    const dailyBudget = await checkRateLimit(
      supabase,
      "monthly-summary-daily",
      3,
      24 * 60 * 60
    );
    if (!dailyBudget.allowed) {
      return NextResponse.json(
        { error: "Daily monthly-summary limit reached" },
        {
          status: 429,
          headers: { "Retry-After": String(dailyBudget.retryAfterSeconds) },
        }
      );
    }

    const summaryText = await generateMonthlySummary(
      entries,
      profile?.display_name || "friend",
      user.id
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
  } finally {
    const { error: releaseError } = await admin.rpc(
      "release_summary_generation",
      {
        p_user_id: user.id,
        p_summary_kind: "monthly",
        p_period_start: monthStartStr,
        p_claim_token: claimToken,
      }
    );
    if (releaseError) console.error("Failed to release monthly summary claim");
  }
}
