import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAcknowledgment } from "@/lib/claude";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // Get profile for display name
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, streak_count, last_entry_date")
    .eq("id", user.id)
    .single();

  // Upsert entry (one per user per day)
  const { data: entry, error } = await supabase
    .from("entries")
    .upsert(
      {
        user_id: user.id,
        entry_date: body.entry_date || new Date().toISOString().split("T")[0],
        mood_score: body.mood_score,
        mood_label: body.mood_label,
        mood_tags: body.mood_tags,
        prompt_question: body.prompt_question,
        prompt_answer: body.prompt_answer,
        highlight: body.highlight,
        challenge: body.challenge,
        gratitude: body.gratitude,
        free_write: body.free_write,
        word_count: body.word_count,
        entry_duration_seconds: body.entry_duration_seconds,
        voice_used: body.voice_used ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,entry_date" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Generate AI acknowledgment
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

    // Save acknowledgment back to entry
    await supabase
      .from("entries")
      .update({
        ai_acknowledgment: aiAcknowledgment,
        ai_generated_at: new Date().toISOString(),
      })
      .eq("id", entry.id);
  } catch {
    // AI generation failed — entry is still saved
  }

  // Update streak
  const today = body.entry_date || new Date().toISOString().split("T")[0];

  // Record prompt interaction as answered (if prompt was answered)
  if (body.prompt_question && body.prompt_answer) {
    await supabase.from("prompt_interactions").insert({
      user_id: user.id,
      prompt_text: body.prompt_question,
      prompt_category: body.prompt_category || "",
      interaction_type: "answered",
      entry_date: today,
    });
  }
  // Calculate streak from actual entries
  const { data: recentEntries } = await supabase
    .from("entries")
    .select("entry_date")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .limit(365);

  let newStreak = 0;
  if (recentEntries && recentEntries.length > 0) {
    const entryDates = new Set(recentEntries.map((e) => e.entry_date));
    const checkDate = new Date(today + "T00:00:00");
    while (entryDates.has(checkDate.toISOString().split("T")[0])) {
      newStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    }
  }
  if (newStreak === 0) newStreak = 1; // just saved today

  await supabase
    .from("profiles")
    .update({ streak_count: newStreak, last_entry_date: today })
    .eq("id", user.id);

  return NextResponse.json({
    entry,
    ai_acknowledgment: aiAcknowledgment,
    streak_count: newStreak,
  });
}
