import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  // Handle PKCE flow (code exchange)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Code exchange error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth&detail=${encodeURIComponent(error.message)}`);
    }
  }
  // Handle magic link token hash flow
  else if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: type as "email" | "magiclink" });
    if (error) {
      console.error("OTP verify error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth&detail=${encodeURIComponent(error.message)}`);
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=auth&detail=no_code_or_token`);
  }

  // Check allowed emails
  const { data: { user } } = await supabase.auth.getUser();
  const allowedEmails = process.env.ALLOWED_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) || [];

  if (allowedEmails.length > 0 && user?.email && !allowedEmails.includes(user.email.toLowerCase())) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
