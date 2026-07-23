import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAcknowledgment } from "@/lib/claude";
import { checkRateLimit } from "@/lib/security";
import { validateEntryInput } from "@/lib/validation";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false });

  if (error) {
    console.error("Failed to load entries:", error.message);
    return NextResponse.json(
      { error: "Failed to load entries" },
      { status: 500 }
    );
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkRateLimit(supabase, "entries", 20, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validated = validateEntryInput(rawBody);
  if (!validated.data) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const body = validated.data;
  const { prompt_category: promptCategory, ...entryData } = body;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const { data: entry, error } = await supabase
    .from("entries")
    .upsert(
      {
        user_id: user.id,
        ...entryData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,entry_date" }
    )
    .select()
    .single();

  if (error || !entry) {
    console.error("Failed to save entry:", error?.message ?? "No row returned");
    return NextResponse.json(
      { error: "Failed to save entry" },
      { status: 500 }
    );
  }

  let aiAcknowledgment = "";
  try {
    aiAcknowledgment = await generateAcknowledgment(
      {
        mood_score: body.mood_score,
        mood_label: body.mood_label,
        prompt_question: body.prompt_question,
        prompt_answer: body.prompt_answer,
        highlight: body.highlight,
        challenge: body.challenge,
        gratitude: body.gratitude,
        free_write: body.free_write,
      },
      profile?.display_name || "friend"
    );

    const { error: acknowledgmentError } = await supabase
      .from("entries")
      .update({
        ai_acknowledgment: aiAcknowledgment,
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", entry.id)
      .eq("user_id", user.id);

    if (acknowledgmentError) {
      console.error("Failed to save AI acknowledgment:", acknowledgmentError.message);
    }
  } catch {
    // The journal entry remains saved if the provider is temporarily unavailable.
  }

  const today = body.entry_date;

  if (body.prompt_question && body.prompt_answer) {
    const { error: interactionError } = await supabase
      .from("prompt_interactions")
      .insert({
        user_id: user.id,
        prompt_text: body.prompt_question,
        prompt_category: promptCategory || "general",
        interaction_type: "answered",
        entry_date: today,
      });
    if (interactionError) {
      console.error("Failed to record prompt interaction:", interactionError.message);
    }
  }

  const { data: recentEntries } = await supabase
    .from("entries")
    .select("entry_date")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .limit(365);

  let newStreak = 0;
  if (recentEntries && recentEntries.length > 0) {
    const entryDates = new Set(recentEntries.map((item) => item.entry_date));
    const checkDate = new Date(`${today}T00:00:00`);
    while (entryDates.has(checkDate.toISOString().split("T")[0])) {
      newStreak += 1;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }
  if (newStreak === 0) newStreak = 1;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ streak_count: newStreak, last_entry_date: today })
    .eq("id", user.id);
  if (profileError) {
    console.error("Failed to update streak:", profileError.message);
  }

  return NextResponse.json({
    entry,
    ai_acknowledgment: aiAcknowledgment,
    streak_count: newStreak,
  });
}
