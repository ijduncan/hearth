import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readLimitedJson } from "@/lib/security";
import { isValidDateString, parseJsonObject } from "@/lib/validation";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsedBody = await readLimitedJson(request, 2 * 1024);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.tooLarge ? "Request body too large" : "Invalid JSON body" },
      { status: parsedBody.tooLarge ? 413 : 400 }
    );
  }
  const body = parseJsonObject(parsedBody.value);
  const entryId = body?.entryId;
  const newDate = body?.newDate;

  if (typeof entryId !== "string" || !UUID.test(entryId) || !isValidDateString(newDate)) {
    return NextResponse.json(
      { error: "A valid entryId and YYYY-MM-DD newDate are required" },
      { status: 400 }
    );
  }

  // Check the entry belongs to this user
  const { data: entry, error: fetchError } = await supabase
    .from("entries")
    .select("id, entry_date")
    .eq("id", entryId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !entry) {
    return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  }

  if (entry.entry_date === newDate) {
    return NextResponse.json(
      { error: "Entry is already on that date" },
      { status: 400 }
    );
  }

  // Check no entry already exists on the target date
  const { data: existing } = await supabase
    .from("entries")
    .select("id")
    .eq("user_id", user.id)
    .eq("entry_date", newDate)
    .single();

  if (existing) {
    return NextResponse.json(
      { error: "An entry already exists on that date" },
      { status: 409 }
    );
  }

  // Move the entry
  const { data: updated, error: updateError } = await supabase
    .from("entries")
    .update({ entry_date: newDate, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateError) {
    console.error("Failed to move entry:", updateError.message);
    return NextResponse.json(
      { error: "Failed to move entry" },
      { status: 500 }
    );
  }

  return NextResponse.json(updated);
}
