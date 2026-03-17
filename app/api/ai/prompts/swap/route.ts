import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPersonalizedPrompt } from "@/lib/prompts";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const entryDate =
    body.entry_date || new Date().toLocaleDateString("en-CA");
  const skippedText: string = body.skipped_prompt_text;
  const skippedCategory: string = body.skipped_prompt_category;

  // Record the skip
  if (skippedText) {
    await supabase.from("prompt_interactions").insert({
      user_id: user.id,
      prompt_text: skippedText,
      prompt_category: skippedCategory,
      interaction_type: "skipped",
      entry_date: entryDate,
    });
  }

  // Get all prompts shown today (to exclude)
  const { data: todayInteractions } = await supabase
    .from("prompt_interactions")
    .select("prompt_text")
    .eq("user_id", user.id)
    .eq("entry_date", entryDate);

  const excludeTexts = (todayInteractions || []).map((i) => i.prompt_text);

  // Get full interaction history for personalization
  const { data: allInteractions } = await supabase
    .from("prompt_interactions")
    .select("*")
    .eq("user_id", user.id);

  // Select a new prompt
  const newPrompt = getPersonalizedPrompt(
    new Date(entryDate),
    allInteractions || [],
    excludeTexts
  );

  // Record it as shown
  await supabase.from("prompt_interactions").insert({
    user_id: user.id,
    prompt_text: newPrompt.text,
    prompt_category: newPrompt.category,
    interaction_type: "shown",
    entry_date: entryDate,
  });

  return NextResponse.json(newPrompt);
}
