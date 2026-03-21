import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateTherapistSummary } from "@/lib/claude";
import { format } from "date-fns";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const startDate: string = body.startDate;
  const endDate: string = body.endDate;

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
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
    .order("entry_date");

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
  } catch {
    return NextResponse.json(
      { error: "Failed to generate therapist summary" },
      { status: 500 }
    );
  }
}
