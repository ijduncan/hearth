const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    moodTags.length > 10 ||
    moodTags.some((tag) => typeof tag !== "string" || tag.length > 40)
  ) {
    return { error: "mood_tags may contain at most 10 short labels" };
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
