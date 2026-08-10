import { NextResponse } from "next/server";
import { startOfWeek, endOfWeek, format } from "date-fns";
import { generateWeeklySummary } from "@/lib/claude";
import { verifyBearerSecret } from "@/lib/security";
import { createAdminClient } from "@/lib/supabase/admin";

interface EligibleProfile {
  user_id: string;
  display_name: string;
}

export async function GET(request: Request) {
  if (!verifyBearerSecret(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    console.error("Supabase admin credentials are not configured for weekly summaries");
    return NextResponse.json({ error: "Summary service is not configured" }, { status: 503 });
  }

  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  const weekStartStr = format(weekStart, "yyyy-MM-dd");
  const weekEndStr = format(weekEnd, "yyyy-MM-dd");

  // This service-only RPC joins the current Auth identity to the live
  // allowlist before any journal rows are read or sent to the AI provider.
  const { data: profileRows, error: profileError } = await supabase.rpc(
    "get_allowed_profiles_for_cron"
  );
  if (profileError) {
    console.error("Failed to load eligible weekly-summary profiles");
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }

  const profiles = (profileRows ?? []) as EligibleProfile[];
  const results = {
    eligible: profiles.length,
    generated: 0,
    alreadyExists: 0,
    inProgress: 0,
    noEntries: 0,
    failed: 0,
  };

  for (const profile of profiles) {
    const { data: existing, error: existingError } = await supabase
      .from("weekly_summaries")
      .select("id")
      .eq("user_id", profile.user_id)
      .eq("week_start", weekStartStr)
      .maybeSingle();

    if (existingError) {
      console.error("Failed to check for an existing weekly summary");
      results.failed += 1;
      continue;
    }
    if (existing) {
      results.alreadyExists += 1;
      continue;
    }

    const { data: entries, error: entriesError } = await supabase
      .from("entries")
      .select("*")
      .eq("user_id", profile.user_id)
      .gte("entry_date", weekStartStr)
      .lte("entry_date", weekEndStr)
      .order("entry_date");

    if (entriesError) {
      console.error("Failed to load entries for a weekly summary");
      results.failed += 1;
      continue;
    }
    if (!entries || entries.length === 0) {
      results.noEntries += 1;
      continue;
    }

    const { data: claimToken, error: claimError } = await supabase.rpc(
      "claim_summary_generation",
      {
        p_user_id: profile.user_id,
        p_summary_kind: "weekly",
        p_period_start: weekStartStr,
      }
    );
    if (claimError) {
      console.error("Failed to claim a scheduled weekly summary");
      results.failed += 1;
      continue;
    }
    if (typeof claimToken !== "string") {
      results.inProgress += 1;
      continue;
    }

    try {
      const summaryText = await generateWeeklySummary(entries, profile.display_name);
      const avgMood =
        entries.reduce((sum, entry) => sum + (entry.mood_score || 0), 0) /
        entries.length;

      const tagCounts: Record<string, number> = {};
      entries.forEach((entry) => {
        (entry.mood_tags || []).forEach((tag: string) => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      });
      const dominantTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([tag]) => tag);

      const { error: saveError } = await supabase.from("weekly_summaries").upsert(
        {
          user_id: profile.user_id,
          week_start: weekStartStr,
          week_end: weekEndStr,
          summary_text: summaryText,
          avg_mood: Math.round(avgMood * 10) / 10,
          dominant_tags: dominantTags,
        },
        { onConflict: "user_id,week_start" }
      );

      if (saveError) {
        console.error("Failed to save a scheduled weekly summary");
        results.failed += 1;
        continue;
      }

      results.generated += 1;
    } catch {
      console.error("Failed to generate a scheduled weekly summary");
      results.failed += 1;
    } finally {
      const { error: releaseError } = await supabase.rpc(
        "release_summary_generation",
        {
          p_user_id: profile.user_id,
          p_summary_kind: "weekly",
          p_period_start: weekStartStr,
          p_claim_token: claimToken,
        }
      );
      if (releaseError) console.error("Failed to release a weekly summary claim");
    }
  }

  return NextResponse.json({ results });
}
