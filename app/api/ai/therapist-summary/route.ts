import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateTherapistSummary } from "@/lib/claude";
import { differenceInCalendarDays, format } from "date-fns";
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

  const rateLimit = await checkRateLimit(supabase, "therapist-summary", 2, 60 * 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many report requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = parseJsonObject(await request.json());
  } catch {
    // Handled by validation below.
  }
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
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const periodLabel = `${format(new Date(startDate + "T00:00:00"), "MMM d, yyyy")} to ${format(new Date(endDate + "T00:00:00"), "MMM d, yyyy")}`;

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
