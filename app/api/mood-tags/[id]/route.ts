import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidUuid, parseJsonObject } from "@/lib/validation";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

async function authenticate() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: json({ error: "Unauthorized" }, 401) } as const;
  }

  return { supabase } as const;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  if (!isValidUuid(id)) {
    return json({ error: "A valid mood tag id is required" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("delete_saved_mood_tag", {
    p_id: id,
  });

  if (error) {
    if (error.code === "22023") {
      return json({ error: "Invalid mood tag id" }, 400);
    }
    if (error.code === "42501") {
      return json({ error: "Forbidden" }, 403);
    }
    console.error("Failed to delete mood tag");
    return json({ error: "Failed to delete mood tag" }, 500);
  }

  const result = parseJsonObject(data);
  if (result?.status === "rate_limited") {
    const retryAfter = Number(result.retry_after_seconds);
    return json(
      { error: "Too many requests" },
      429,
      {
        "Retry-After": String(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.ceil(retryAfter)
            : 60
        ),
      }
    );
  }
  if (result?.status !== "ok") {
    console.error("Saved mood tag deletion returned invalid data");
    return json({ error: "Failed to delete mood tag" }, 500);
  }

  return new NextResponse(null, {
    status: 204,
    headers: NO_STORE_HEADERS,
  });
}
