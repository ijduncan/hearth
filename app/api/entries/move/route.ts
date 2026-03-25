import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entryId, newDate } = await request.json();

  if (!entryId || !newDate) {
    return NextResponse.json(
      { error: "entryId and newDate are required" },
      { status: 400 }
    );
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    return NextResponse.json(
      { error: "newDate must be YYYY-MM-DD" },
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
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  return NextResponse.json(updated);
}
