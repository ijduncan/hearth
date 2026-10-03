import type { SupabaseClient } from "@supabase/supabase-js";
import type { Entry } from "./types";

export type JournalInput = Pick<Entry,
  "entry_date" | "mood_score" | "mood_label" | "mood_tags" |
  "prompt_question" | "prompt_answer" | "highlight" | "challenge" |
  "gratitude" | "free_write"
>;

// Fetch explicit user-owned source fields, never AI-generated interpretations.
const SOURCE_FIELDS = "entry_date,mood_score,mood_label,mood_tags,prompt_question,prompt_answer,highlight,challenge,gratitude,free_write";

export async function loadJournalHistory(
  client: SupabaseClient,
  userId: string
): Promise<JournalInput[]> {
  const entries: JournalInput[] = [];
  const pageSize = 500;
  // Keyset paging avoids Supabase's default row limit and offset shifts.
  // Entries have a unique (user_id, entry_date) constraint.
  let after: string | undefined;
  while (true) {
    let query = client.from("entries").select(SOURCE_FIELDS)
      .eq("user_id", userId).order("entry_date").limit(pageSize);
    if (after) query = query.gt("entry_date", after);
    const { data, error } = await query;
    if (error) throw new Error("Failed to load complete journal history");
    if (!data?.length) break;
    entries.push(...data);
    after = data[data.length - 1].entry_date;
    // Continue until an empty page, even if the server caps pages below 500.
  }
  return entries;
}

export function splitReviewInput(text: string, size = 60_000): string[] {
  const chunks: string[] = [];
  if (size < 2) throw new Error("Review chunk size must be at least two");
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + size, text.length);
    if (end < text.length) {
      // Prefer complete JSON entry lines and never split a Unicode pair.
      const newline = text.lastIndexOf("\n", end - 1);
      if (newline > offset + size / 2) end = newline + 1;
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}
