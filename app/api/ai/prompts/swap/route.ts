import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPersonalizedPrompt } from "@/lib/prompts";
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

  const rateLimit = await checkRateLimit(supabase, "prompt-swap", 30, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const parsedBody = await readLimitedJson(request, 2 * 1024);
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
  const entryDate =
    body.entry_date || new Date().toLocaleDateString("en-CA");
  const skippedText = body.skipped_prompt_text;
  const skippedCategory = body.skipped_prompt_category;

  if (
    !isValidDateString(entryDate) ||
    (skippedText != null &&
      (typeof skippedText !== "string" || skippedText.length > 500)) ||
    (skippedCategory != null &&
      (typeof skippedCategory !== "string" || skippedCategory.length > 100))
  ) {
    return NextResponse.json({ error: "Invalid prompt request" }, { status: 400 });
  }

  // Record the skip
  if (typeof skippedText === "string" && skippedText) {
    await supabase.from("prompt_interactions").insert({
      user_id: user.id,
      prompt_text: skippedText,
      prompt_category:
        typeof skippedCategory === "string" ? skippedCategory : "general",
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
