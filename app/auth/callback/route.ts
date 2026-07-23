import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeRedirectPath(searchParams.get("next"));

  const supabase = await createClient();

  // Handle PKCE flow (code exchange)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("Code exchange error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }
  // Handle magic link token hash flow
  else if (token_hash && (type === "email" || type === "magiclink")) {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (error) {
      console.error("OTP verify error:", error.message);
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  } else {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  // The database is the single source of truth for the private allowlist.
  const { data: isAllowed, error: allowlistError } = await supabase.rpc(
    "is_allowed_user"
  );
  if (allowlistError || !isAllowed) {
    if (allowlistError) console.error("Allowlist check failed");
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=unauthorized`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
