import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateAcknowledgment } from "@/lib/claude";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { entry, userDisplayName } = await request.json();

  try {
    const acknowledgment = await generateAcknowledgment(entry, userDisplayName);
    return NextResponse.json({ acknowledgment });
  } catch {
    return NextResponse.json(
      { error: "Failed to generate acknowledgment" },
      { status: 500 }
    );
  }
}
