import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next"));

  const supabase = await createClient();

  // Require the browser-bound PKCE verifier. Accepting a bare token hash here
  // would let a forwarded link sign a victim into somebody else's account.
  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("Code exchange error:", error.message);
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
