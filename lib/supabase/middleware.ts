import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  exceedsBodyLimit,
  isTrustedMutation,
} from "@/lib/security";

function noStore<T extends NextResponse>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function redirectWithCookies(url: URL, source: NextResponse): NextResponse {
  const response = NextResponse.redirect(url);
  for (const cookie of source.cookies.getAll()) {
    response.cookies.set(cookie);
  }
  return noStore(response);
}

export async function updateSession(
  request: NextRequest,
  forwardedHeaders?: Headers
) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const isCron = pathname.startsWith("/api/cron/");
  const bodyLimit =
    pathname === "/api/entries" || pathname === "/api/entry-drafts"
      ? 160 * 1024
      : 64 * 1024;

  if (isApi && !isTrustedMutation(request)) {
    return noStore(
      NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
    );
  }

  if (isApi && exceedsBodyLimit(request, bodyLimit)) {
    return noStore(
      NextResponse.json({ error: "Request body too large" }, { status: 413 })
    );
  }

  const createNextResponse = () => {
    const headers = new Headers(request.headers);
    if (forwardedHeaders) {
      const nonce = forwardedHeaders.get("x-nonce");
      const contentSecurityPolicy = forwardedHeaders.get(
        "Content-Security-Policy"
      );
      if (nonce) headers.set("x-nonce", nonce);
      if (contentSecurityPolicy) {
        headers.set("Content-Security-Policy", contentSecurityPolicy);
      }
    }
    return NextResponse.next({ request: { headers } });
  };

  let supabaseResponse = createNextResponse();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = createNextResponse();
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Cron endpoints authenticate with CRON_SECRET inside their route handlers.
  if (isCron) return noStore(supabaseResponse);

  const isPublicPath =
    pathname.startsWith("/login") || pathname.startsWith("/auth/");

  if (!user) {
    if (isPublicPath) return noStore(supabaseResponse);

    if (isApi) {
      return noStore(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  // Recheck the allowlist on every authenticated request so removing an email
  // revokes existing sessions, not only future magic-link callbacks.
  const { data: isAllowed, error: allowlistError } = await supabase.rpc(
    "is_allowed_user"
  );

  if (allowlistError || !isAllowed) {
    if (allowlistError) {
      console.error("Allowlist check failed");
    }
    await supabase.auth.signOut();
    if (isApi) {
      return noStore(
        NextResponse.json({ error: "Forbidden" }, { status: 403 })
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?error=unauthorized";
    return redirectWithCookies(url, supabaseResponse);
  }

  if (pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, supabaseResponse);
  }

  return noStore(supabaseResponse);
}
