import { NextResponse } from "next/server";
import { checkRateLimit, readLimitedJson } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import type { EntryDraft } from "@/lib/types";
import {
  isValidDateString,
  parseJsonObject,
  validateEntryDraftInput,
} from "@/lib/validation";

const DRAFT_COLUMNS = [
  "user_id",
  "entry_date",
  "revision",
  "last_client_id",
  "last_client_sequence",
  "step",
  "mood_score",
  "mood_tags",
  "prompt_question",
  "prompt_category",
  "prompt_answer",
  "highlight",
  "challenge",
  "gratitude",
  "free_write",
  "swap_count",
  "duration_seconds",
  "created_at",
  "updated_at",
].join(",");

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
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

export async function GET(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const rateLimit = await checkRateLimit(auth.supabase, "entry-drafts", 60, 60);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const requestedDates = new URL(request.url).searchParams.getAll("entry_date");
  if (requestedDates.length !== 1 || !isValidDateString(requestedDates[0])) {
    return json(
      { error: "A single valid YYYY-MM-DD entry_date is required" },
      400
    );
  }
  const entryDate = requestedDates[0];

  const [entryResult, draftResult] = await Promise.all([
    auth.supabase
      .from("entries")
      .select("id")
      .eq("user_id", auth.user.id)
      .eq("entry_date", entryDate)
      .maybeSingle(),
    auth.supabase
      .from("entry_drafts")
      .select(DRAFT_COLUMNS)
      .eq("user_id", auth.user.id)
      .eq("entry_date", entryDate)
      .maybeSingle(),
  ]);

  if (entryResult.error || draftResult.error) {
    console.error("Failed to load an entry draft");
    return json({ error: "Failed to load entry draft" }, 500);
  }

  const finalized = entryResult.data !== null;
  return json({
    draft: finalized ? null : (draftResult.data as EntryDraft | null),
    finalized,
  });
}

export async function PUT(request: Request) {
  const auth = await authenticate();
  if ("response" in auth) return auth.response;

  const parsedBody = await readLimitedJson(request, 160 * 1024);
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

  const validated = validateEntryDraftInput(parsedBody.value);
  if (!validated.data) {
    return json({ error: validated.error }, 400);
  }
  const draft = validated.data;

  const { data, error } = await auth.supabase.rpc("save_entry_draft", {
    p_entry_date: draft.entry_date,
    p_client_id: draft.client_id,
    p_client_sequence: draft.client_sequence,
    p_expected_revision: draft.expected_revision,
    p_step: draft.step,
    p_mood_score: draft.mood_score,
    p_mood_tags: draft.mood_tags,
    p_prompt_question: draft.prompt_question,
    p_prompt_category: draft.prompt_category,
    p_prompt_answer: draft.prompt_answer,
    p_highlight: draft.highlight,
    p_challenge: draft.challenge,
    p_gratitude: draft.gratitude,
    p_free_write: draft.free_write,
    p_swap_count: draft.swap_count,
    p_duration_seconds: draft.duration_seconds,
  });

  if (error) {
    console.error("Failed to save an entry draft");
    if (error.code === "22023") {
      return json({ error: "Invalid entry draft" }, 400);
    }
    if (error.code === "42501") {
      return json({ error: "Forbidden" }, 403);
    }
    return json({ error: "Failed to save entry draft" }, 500);
  }

  const result = parseJsonObject(data);
  if (result?.status === "rate_limited") {
    const retryAfter =
      typeof result.retry_after_seconds === "number"
        ? Math.max(1, Math.ceil(result.retry_after_seconds))
        : 60;
    return NextResponse.json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(retryAfter),
        },
      }
    );
  }
  if (result?.status === "finalized") {
    return json(
      { error: "An entry for this date is already finalized", code: "finalized" },
      409
    );
  }
  if (result?.status === "stale") {
    const currentDraft = parseJsonObject(result.current_draft);
    return json(
      {
        error: "This draft has changed in another session",
        code: "stale",
        current_draft: currentDraft as unknown as EntryDraft | null,
      },
      409
    );
  }

  const savedDraft = parseJsonObject(result?.draft);
  if (
    (result?.status !== "ok" && result?.status !== "superseded") ||
    !savedDraft
  ) {
    console.error("Entry draft save returned an invalid result");
    return json({ error: "Failed to save entry draft" }, 500);
  }

  const superseded = result.status === "superseded";
  return json({
    draft: savedDraft as unknown as EntryDraft,
    applied: !superseded,
    superseded,
  });
}
