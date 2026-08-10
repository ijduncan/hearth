import { NextResponse } from "next/server";
import { readLimitedJson } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import {
  MOOD_TAGS,
  type SavedMoodTag,
} from "@/lib/types";
import {
  isValidUuid,
  normalizeSavedMoodTagLabel,
  parseJsonObject,
} from "@/lib/validation";

const SAVED_MOOD_TAG_COLUMNS = "id,user_id,label,created_at";
const PRESET_MOOD_TAGS = new Set<string>(
  MOOD_TAGS.map((label) => label.toLowerCase())
);
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...NO_STORE_HEADERS, ...headers },
  });
}

function parseSavedMoodTag(
  value: unknown,
  expectedUserId: string
): SavedMoodTag | null {
  const tag = parseJsonObject(value);
  if (
    !tag ||
    !isValidUuid(tag.id) ||
    tag.user_id !== expectedUserId ||
    typeof tag.label !== "string" ||
    typeof tag.created_at !== "string"
  ) {
    return null;
  }

  return {
    id: tag.id,
    user_id: tag.user_id,
    label: tag.label,
    created_at: tag.created_at,
  };
}

async function authenticate() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { response: json({ error: "Unauthorized" }, 401) } as const;
  }

  return { supabase, user } as const;
}

export async function GET() {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const { data, error } = await auth.supabase
    .from("saved_mood_tags")
    .select(SAVED_MOOD_TAG_COLUMNS)
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("Failed to load saved mood tags");
    return json({ error: "Failed to load saved mood tags" }, 500);
  }

  const tags = (data ?? [])
    .map((tag) => parseSavedMoodTag(tag, auth.user.id))
    .filter((tag): tag is SavedMoodTag => tag !== null);

  if (tags.length !== (data ?? []).length) {
    console.error("Saved mood tag query returned invalid data");
    return json({ error: "Failed to load saved mood tags" }, 500);
  }

  return json({ tags });
}

export async function POST(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const parsedBody = await readLimitedJson(request, 512);
  if (!parsedBody.ok) {
    return json(
      {
        error: parsedBody.tooLarge
          ? "Request body too large"
          : "Invalid JSON body",
      },
      parsedBody.tooLarge ? 413 : 400
    );
  }

  const body = parseJsonObject(parsedBody.value);
  if (
    !body ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "label")
  ) {
    return json({ error: "A label is required" }, 400);
  }

  const label = normalizeSavedMoodTagLabel(body.label);
  if (!label) {
    return json({ error: "Label must contain 1 to 40 characters" }, 400);
  }
  if (PRESET_MOOD_TAGS.has(label.toLowerCase())) {
    return json({ error: "That word is already available" }, 400);
  }

  const { data, error } = await auth.supabase.rpc("create_saved_mood_tag", {
    p_label: label,
  });

  if (error) {
    if (error.code === "22023") {
      return json({ error: "Invalid mood tag label" }, 400);
    }
    if (error.code === "42501") {
      return json({ error: "Forbidden" }, 403);
    }
    console.error("Failed to save mood tag");
    return json({ error: "Failed to save mood tag" }, 500);
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
  if (result?.status === "limit_reached") {
    return json(
      { error: "You can save up to 100 custom mood words" },
      409
    );
  }

  const tag = parseSavedMoodTag(result?.tag, auth.user.id);
  if (result?.status !== "ok" || !tag) {
    console.error("Saved mood tag mutation returned invalid data");
    return json({ error: "Failed to save mood tag" }, 500);
  }

  return json({ tag });
}
