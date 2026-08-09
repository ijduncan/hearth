import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAcknowledgment } from "@/lib/claude";
import { checkRateLimit, readLimitedJson } from "@/lib/security";
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

  const parsedBody = await readLimitedJson(request, 48 * 1024);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.tooLarge ? "Request body too large" : "Invalid JSON body" },
      { status: parsedBody.tooLarge ? 413 : 400 }
    );
  }

  const validated = validateEntryInput(parsedBody.value);
  if (!validated.data) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const body = validated.data;
  const { prompt_category: promptCategory, ...entryData } = body;
  const acknowledgmentInput = {
    mood_score: body.mood_score,
    mood_label: body.mood_label,
    prompt_question: body.prompt_question,
    prompt_answer: body.prompt_answer,
    highlight: body.highlight,
    challenge: body.challenge,
    gratitude: body.gratitude,
    free_write: body.free_write,
  };
  const aiInputHash = createHash("sha256")
    .update(JSON.stringify({ version: 1, ...acknowledgmentInput }))
    .digest("hex");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("display_name, ai_enabled")
    .eq("id", user.id)
    .single();
  const aiEnabled = !profileError && profile?.ai_enabled === true;

  const { data: entry, error } = await supabase
    .from("entries")
    .upsert(
      {
        user_id: user.id,
        ...entryData,
        ai_content_hash: aiInputHash,
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

  const contentChanged = entry.ai_input_hash !== aiInputHash;
  let aiAcknowledgment =
    !contentChanged && typeof entry.ai_acknowledgment === "string"
      ? entry.ai_acknowledgment
      : "";
  let aiRateLimited = false;
  let responseEntry = contentChanged
    ? {
        ...entry,
        ai_acknowledgment: null,
        ai_generated_at: null,
        ai_input_hash: null,
      }
    : entry;

  if (!aiEnabled && contentChanged) {
    const { error: clearError } = await supabase
      .from("entries")
      .update({
        ai_acknowledgment: null,
        ai_generated_at: null,
        ai_input_hash: null,
      })
      .eq("id", entry.id)
      .eq("user_id", user.id)
      .eq("updated_at", entry.updated_at);
    if (clearError) console.error("Failed to clear an outdated AI acknowledgment");
  }

  if (aiEnabled && !aiAcknowledgment) {
    const { data: claimToken, error: claimError } = await supabase.rpc(
      "claim_entry_ai_generation",
      {
        p_entry_id: entry.id,
        p_input_hash: aiInputHash,
      }
    );

    if (claimError) {
      console.error("Failed to claim AI acknowledgment generation");
    } else if (typeof claimToken === "string") {
      const aiBudget = await checkRateLimit(
        supabase,
        "entry-ai-daily",
        10,
        24 * 60 * 60
      );

      if (!aiBudget.allowed) {
        aiRateLimited = true;
        await supabase.rpc("release_entry_ai_generation", {
          p_entry_id: entry.id,
          p_claim_token: claimToken,
        });
      } else {
        try {
          aiAcknowledgment = await generateAcknowledgment(
            acknowledgmentInput,
            profile?.display_name || "friend"
          );
          if (!aiAcknowledgment.trim()) {
            throw new Error("AI acknowledgment was empty");
          }

          const generatedAt = new Date().toISOString();
          const { data: completed, error: acknowledgmentError } =
            await supabase.rpc("complete_entry_ai_generation", {
              p_entry_id: entry.id,
              p_input_hash: aiInputHash,
              p_claim_token: claimToken,
              p_acknowledgment: aiAcknowledgment,
            });

          if (acknowledgmentError || completed !== true) {
            console.error("Failed to save the current AI acknowledgment");
            aiAcknowledgment = "";
          } else {
            responseEntry = {
              ...responseEntry,
              ai_acknowledgment: aiAcknowledgment,
              ai_generated_at: generatedAt,
              ai_input_hash: aiInputHash,
            };
          }
        } catch {
          // The journal entry remains saved if the provider is unavailable.
          await supabase.rpc("release_entry_ai_generation", {
            p_entry_id: entry.id,
            p_claim_token: claimToken,
          });
        }
      }
    }
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

  const { error: streakProfileError } = await supabase
    .from("profiles")
    .update({ streak_count: newStreak, last_entry_date: today })
    .eq("id", user.id);
  if (streakProfileError) {
    console.error("Failed to update streak:", streakProfileError.message);
  }

  return NextResponse.json({
    entry: responseEntry,
    ai_acknowledgment: aiAcknowledgment,
    ai_rate_limited: aiRateLimited,
    streak_count: newStreak,
  });
}
