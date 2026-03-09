import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // Check allowed emails
      const { data: { user } } = await supabase.auth.getUser();
      const allowedEmails = process.env.ALLOWED_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || [];

      if (allowedEmails.length > 0 && user?.email && !allowedEmails.includes(user.email.toLowerCase())) {
        await supabase.auth.signOut();
        return NextResponse.redirect(`${origin}/login?error=unauthorized`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
