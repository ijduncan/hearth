import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, isTrustedMutation, readLimitedJson } from "@/lib/security";
import { parseJsonObject } from "@/lib/validation";
import { isUuid } from "@/lib/partner-validation";
import { generatePartnerGlimpse, isOpenAIConfigured } from "@/lib/openai";

export const maxDuration = 180;

export async function POST(request: Request) {
  if (!isTrustedMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await readLimitedJson(request, 1024);
  const body = parsed.ok ? parseJsonObject(parsed.value) : null;
  if (!body || !isUuid(body.entryId)) return NextResponse.json({ error: "Choose a saved entry" }, { status: 400 });
  const [{ data: state, error: stateError }, { data: profile, error: profileError }] = await Promise.all([
    db.rpc("get_partner_state"),
    db.from("profiles").select("ai_enabled").eq("id", user.id).single(),
  ]);
  if (stateError || !state?.connection || state.connection.available === false) return NextResponse.json({ error: "Connect with a partner first" }, { status: 403 });
  if (profileError || !profile?.ai_enabled || !isOpenAIConfigured()) return NextResponse.json({ error: "AI drafting is unavailable. You can write your own glimpse." }, { status: 503 });
  const { data: entry, error } = await db.from("entries")
    .select("entry_date,mood_score,mood_label,mood_tags,prompt_question,prompt_answer,highlight,challenge,gratitude,free_write")
    .eq("id", body.entryId).eq("user_id", user.id).single();
  if (error || !entry) return NextResponse.json({ error: "Entry unavailable" }, { status: 404 });
  const quota = await checkRateLimit(db, "partner-glimpse-ai", 5, 86400);
  if (!quota.allowed) return NextResponse.json({ error: "Daily draft limit reached. You can write your own glimpse." }, { status: 429 });
  try {
    // Preview only: no shared record is written until the author presses Share.
    const text = await generatePartnerGlimpse(entry, user.id);
    return NextResponse.json({ text }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not draft a glimpse. You can write your own." }, { status: 502 });
  }
}
