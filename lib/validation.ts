import {
  MAX_MOOD_TAG_LENGTH,
  MAX_MOOD_TAGS,
  type EntryDraftStep,
} from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidDateString(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !ISO_DATE.test(value) ||
    value.startsWith("0000-")
  ) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseJsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(
  value: unknown,
  maxLength: number
): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length <= maxLength ? trimmed : undefined;
}

export type ValidatedEntryInput = {
  entry_date: string;
  draft_revision: number;
  prompt_question: string | null;
  prompt_answer: string | null;
  prompt_category: string | null;
  highlight: string | null;
  challenge: string | null;
  gratitude: string | null;
  free_write: string | null;
  mood_score: number | null;
  mood_label: string | null;
  mood_tags: string[];
  word_count: number | null;
  entry_duration_seconds: number | null;
  voice_used: boolean;
};

export function validateEntryInput(
  value: unknown
): { data?: ValidatedEntryInput; error?: string } {
  const body = parseJsonObject(value);
  if (!body) return { error: "Request body must be a JSON object" };
  if (!isValidDateString(body.entry_date)) {
    return { error: "entry_date must be a valid YYYY-MM-DD date" };
  }
  if (
    typeof body.draft_revision !== "number" ||
    !Number.isInteger(body.draft_revision) ||
    body.draft_revision < 1 ||
    body.draft_revision > 2_147_483_647
  ) {
    return { error: "draft_revision must be a positive integer" };
  }

  const textLimits = {
    prompt_question: 500,
    prompt_answer: 5_000,
    prompt_category: 100,
    highlight: 2_000,
    challenge: 2_000,
    gratitude: 2_000,
    free_write: 20_000,
    mood_label: 100,
  } as const;

  const text: Record<string, string | null> = {};
  for (const [field, limit] of Object.entries(textLimits)) {
    const parsed = optionalText(body[field], limit);
    if (parsed === undefined) {
      return { error: `${field} must be text no longer than ${limit} characters` };
    }
    text[field] = parsed;
  }

  let moodScore: number | null = null;
  if (body.mood_score !== undefined && body.mood_score !== null) {
    if (
      typeof body.mood_score !== "number" ||
      !Number.isFinite(body.mood_score) ||
      body.mood_score < 1 ||
      body.mood_score > 10
    ) {
      return { error: "mood_score must be a number between 1 and 10" };
    }
    moodScore = body.mood_score;
  }

  if (!Array.isArray(body.mood_tags) && body.mood_tags != null) {
    return { error: "mood_tags must be an array" };
  }
  const moodTags = (body.mood_tags ?? []) as unknown[];
  if (
    moodTags.length > MAX_MOOD_TAGS ||
    moodTags.some(
      (tag) => typeof tag !== "string" || tag.length > MAX_MOOD_TAG_LENGTH
    )
  ) {
    return { error: `mood_tags may contain at most ${MAX_MOOD_TAGS} short labels` };
  }

  const boundedInteger = (
    field: string,
    max: number
  ): number | null | undefined => {
    const candidate = body[field];
    if (candidate === undefined || candidate === null) return null;
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < 0 ||
      candidate > max
    ) {
      return undefined;
    }
    return candidate;
  };

  const wordCount = boundedInteger("word_count", 100_000);
  const duration = boundedInteger("entry_duration_seconds", 86_400);
  if (wordCount === undefined || duration === undefined) {
    return { error: "Entry metadata is outside the allowed range" };
  }
  if (body.voice_used != null && typeof body.voice_used !== "boolean") {
    return { error: "voice_used must be a boolean" };
  }

  return {
    data: {
      entry_date: body.entry_date,
      draft_revision: body.draft_revision,
      prompt_question: text.prompt_question,
      prompt_answer: text.prompt_answer,
      prompt_category: text.prompt_category,
      highlight: text.highlight,
      challenge: text.challenge,
      gratitude: text.gratitude,
      free_write: text.free_write,
      mood_score: moodScore,
      mood_label: text.mood_label,
      mood_tags: moodTags.map((tag) => (tag as string).trim()).filter(Boolean),
      word_count: wordCount,
      entry_duration_seconds: duration,
      voice_used: body.voice_used === true,
    },
  };
}

export type ValidatedEntryDraftInput = {
  entry_date: string;
  client_id: string;
  client_sequence: number;
  expected_revision: number | null;
  step: EntryDraftStep;
  mood_score: number | null;
  mood_tags: string[];
  prompt_question: string | null;
  prompt_category: string | null;
  prompt_answer: string | null;
  highlight: string | null;
  challenge: string | null;
  gratitude: string | null;
  free_write: string | null;
  swap_count: number;
  duration_seconds: number;
};

const ENTRY_DRAFT_TEXT_LIMITS = {
  prompt_question: 500,
  prompt_category: 100,
  prompt_answer: 5_000,
  highlight: 2_000,
  challenge: 2_000,
  gratitude: 2_000,
  free_write: 20_000,
} as const;

function hasOwn(value: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function optionalDraftText(
  value: unknown,
  maxLength: number
): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maxLength) return undefined;
  return value;
}

export function validateEntryDraftInput(
  value: unknown
): { data?: ValidatedEntryDraftInput; error?: string } {
  const body = parseJsonObject(value);
  if (!body) return { error: "Request body must be a JSON object" };

  const requiredFields = [
    "entry_date",
    "client_id",
    "client_sequence",
    "expected_revision",
    "step",
    "mood_score",
    "mood_tags",
    ...Object.keys(ENTRY_DRAFT_TEXT_LIMITS),
    "swap_count",
    "duration_seconds",
  ];
  const missingField = requiredFields.find((field) => !hasOwn(body, field));
  if (missingField) return { error: `${missingField} is required` };

  if (!isValidDateString(body.entry_date)) {
    return { error: "entry_date must be a valid YYYY-MM-DD date" };
  }
  if (!isValidUuid(body.client_id)) {
    return { error: "client_id must be a valid UUID" };
  }
  if (
    typeof body.client_sequence !== "number" ||
    !Number.isSafeInteger(body.client_sequence) ||
    body.client_sequence < 1
  ) {
    return { error: "client_sequence must be a positive safe integer" };
  }

  let expectedRevision: number | null = null;
  if (body.expected_revision !== null) {
    if (
      typeof body.expected_revision !== "number" ||
      !Number.isInteger(body.expected_revision) ||
      body.expected_revision < 1 ||
      body.expected_revision > 2_147_483_646
    ) {
      return { error: "expected_revision must be null or a positive integer" };
    }
    expectedRevision = body.expected_revision;
  }

  if (
    body.step !== "mood" &&
    body.step !== "questions" &&
    body.step !== "freewrite"
  ) {
    return { error: "step must be mood, questions, or freewrite" };
  }

  let moodScore: number | null = null;
  if (body.mood_score !== null) {
    if (
      typeof body.mood_score !== "number" ||
      !Number.isFinite(body.mood_score) ||
      body.mood_score < 1 ||
      body.mood_score > 10
    ) {
      return { error: "mood_score must be null or a number between 1 and 10" };
    }
    moodScore = body.mood_score;
  }

  if (!Array.isArray(body.mood_tags)) {
    return { error: "mood_tags must be an array" };
  }
  if (body.mood_tags.length > MAX_MOOD_TAGS) {
    return { error: `mood_tags may contain at most ${MAX_MOOD_TAGS} labels` };
  }
  const moodTags: string[] = [];
  for (const tag of body.mood_tags) {
    if (typeof tag !== "string") {
      return { error: "Each mood tag must be text" };
    }
    const normalizedTag = tag.trim();
    if (
      normalizedTag.length === 0 ||
      normalizedTag.length > MAX_MOOD_TAG_LENGTH
    ) {
      return {
        error: `Each mood tag must contain 1 to ${MAX_MOOD_TAG_LENGTH} characters`,
      };
    }
    moodTags.push(normalizedTag);
  }

  const text = {} as Record<keyof typeof ENTRY_DRAFT_TEXT_LIMITS, string | null>;
  for (const [field, limit] of Object.entries(ENTRY_DRAFT_TEXT_LIMITS) as Array<
    [keyof typeof ENTRY_DRAFT_TEXT_LIMITS, number]
  >) {
    const parsed = optionalDraftText(body[field], limit);
    if (parsed === undefined) {
      return { error: `${field} must be null or text no longer than ${limit} characters` };
    }
    text[field] = parsed;
  }

  if (
    typeof body.swap_count !== "number" ||
    !Number.isInteger(body.swap_count) ||
    body.swap_count < 0 ||
    body.swap_count > 3
  ) {
    return { error: "swap_count must be an integer between 0 and 3" };
  }

  if (
    typeof body.duration_seconds !== "number" ||
    !Number.isInteger(body.duration_seconds) ||
    body.duration_seconds < 0 ||
    body.duration_seconds > 86_400
  ) {
    return { error: "duration_seconds must be an integer between 0 and 86400" };
  }

  return {
    data: {
      entry_date: body.entry_date,
      client_id: body.client_id,
      client_sequence: body.client_sequence,
      expected_revision: expectedRevision,
      step: body.step,
      mood_score: moodScore,
      mood_tags: moodTags,
      prompt_question: text.prompt_question,
      prompt_category: text.prompt_category,
      prompt_answer: text.prompt_answer,
      highlight: text.highlight,
      challenge: text.challenge,
      gratitude: text.gratitude,
      free_write: text.free_write,
      swap_count: body.swap_count,
      duration_seconds: body.duration_seconds,
    },
  };
}
