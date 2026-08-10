import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateTherapistSummary } from "@/lib/claude";
import { differenceInCalendarDays, format } from "date-fns";
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

  const rateLimit = await checkRateLimit(supabase, "therapist-summary", 2, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many report requests" },
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
  const startDate = body?.startDate;
  const endDate = body?.endDate;

  if (!isValidDateString(startDate) || !isValidDateString(endDate)) {
    return NextResponse.json(
      { error: "startDate and endDate must be YYYY-MM-DD" },
      { status: 400 }
    );
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const daySpan = differenceInCalendarDays(end, start);
  if (daySpan < 0 || daySpan > 365) {
    return NextResponse.json(
      { error: "Report period must be between 1 and 366 days" },
      { status: 400 }
    );
  }

  // Get entries for the period
  const { data: entries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .gte("entry_date", startDate)
    .lte("entry_date", endDate)
    .order("entry_date")
    .limit(366);

  if (!entries || entries.length === 0) {
    return NextResponse.json(
      { error: "No entries found for this period" },
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
      { error: "Enable AI reflections in Settings to generate this report" },
      { status: 403 }
    );
  }

  const periodLabel = `${format(new Date(startDate + "T00:00:00"), "MMM d, yyyy")} to ${format(new Date(endDate + "T00:00:00"), "MMM d, yyyy")}`;

  const dailyBudget = await checkRateLimit(
    supabase,
    "therapist-summary-daily",
    5,
    24 * 60 * 60
  );
  if (!dailyBudget.allowed) {
    return NextResponse.json(
      { error: "Daily report limit reached" },
      {
        status: 429,
        headers: { "Retry-After": String(dailyBudget.retryAfterSeconds) },
      }
    );
  }

  try {
    const summary = await generateTherapistSummary(
      entries,
      profile?.display_name || "the client",
      periodLabel
    );

    return NextResponse.json({ summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Therapist summary error:", message);
    return NextResponse.json(
      { error: "Failed to generate therapist summary" },
      { status: 500 }
    );
  }
}
