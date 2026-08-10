import "server-only";

import { createHash } from "node:crypto";
import OpenAI from "openai";

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI is not configured");
  }

  openai ??= new OpenAI({
    apiKey,
    timeout: 120_000,
    maxRetries: 2,
  });
  return openai;
}

function modelFromEnv(value: string | undefined, fallback: string): string {
  // Environment values may pick up a leading byte-order mark when they are
  // piped from PowerShell. OpenAI treats that invisible character as part of
  // the model ID, so normalize it before every request.
  const normalized = value?.replace(/^\uFEFF/, "").trim();
  return normalized || fallback;
}

// Keep GPT-5.6-family model IDs configurable so tier changes do not require a
// code deploy. The defaults intentionally use all three tiers by workload.
const ACKNOWLEDGMENT_MODEL = modelFromEnv(
  process.env.OPENAI_ACKNOWLEDGMENT_MODEL,
  "gpt-5.6-luna"
);
const INSIGHTS_MODEL = modelFromEnv(
  process.env.OPENAI_INSIGHTS_MODEL,
  "gpt-5.6-terra"
);
const REPORT_MODEL = modelFromEnv(
  process.env.OPENAI_REPORT_MODEL,
  "gpt-5.6-sol"
);

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 1))}…`;
}

function normalizeDisplayName(value: string): string {
  return truncateText(value.trim() || "friend", 100);
}

function safetyIdentifier(userId: string): string {
  return createHash("sha256").update(userId).digest("hex");
}

function joinSectionsWithinBudget(
  sections: string[],
  maxCharacters: number
): string {
  if (sections.length === 0) return "";

  const separator = "\n---\n";
  const separatorCharacters = separator.length * (sections.length - 1);
  const perSection = Math.max(
    1,
    Math.floor((maxCharacters - separatorCharacters) / sections.length)
  );

  return sections
    .map((section) => truncateText(section, perSection))
    .join(separator)
    .slice(0, maxCharacters);
}

async function generateText({
  model,
  maxOutputTokens,
  instructions,
  input,
  userId,
}: {
  model: string;
  maxOutputTokens: number;
  instructions: string;
  input: string;
  userId: string;
}): Promise<string> {
  try {
    const response = await getOpenAIClient().responses.create({
      model,
      max_output_tokens: maxOutputTokens,
      instructions,
      input,
      reasoning: { effort: "none" },
      safety_identifier: safetyIdentifier(userId),
      // Journal content is sensitive and these calls are single-turn, so Hearth does
      // not need OpenAI to retain response application state for later retrieval.
      store: false,
    });

    const output = response.output_text.trim();
    if (!output) {
      console.error("OpenAI generation returned no text", {
        model,
        status: response.status,
        incompleteReason: response.incomplete_details?.reason,
      });
      throw new Error("OpenAI returned no text output");
    }

    return output;
  } catch (error) {
    const apiError = error as {
      status?: number;
      code?: string;
      requestID?: string;
    };
    console.error("OpenAI generation failed", {
      model,
      status: apiError.status,
      code: apiError.code,
      requestId: apiError.requestID,
    });
    throw error;
  }
}

const REFLECT_SYSTEM = `You are a quiet, warm presence — not a therapist, coach, or advisor.
Your only job is to acknowledge what someone just shared in their journal.

Rules:
- 3-5 sentences only
- Never give advice or suggestions
- Never use: "journey", "thrive", "delve", "insights", "growth", "amazing", "wonderful", "embrace"
- Write as though you genuinely read every word and noticed something real
- Reference specific things they wrote — not generic platitudes
- End gently, like closing a door softly
- Tone: like a trusted friend who mostly listens
- Use their first name once, naturally`;

const THERAPIST_SYSTEM = `You are preparing a clinical-style summary of journaling data for a mental health professional.
This summary will be shared with a therapist, counselor, or psychiatrist to inform their sessions.

Your summary should be 400-600 words and cover:

- Overview of the period: entries logged, overall mood trajectory
- Mood patterns: stability, volatility, notable shifts with specific dates
- Recurring emotional themes across entries, noting frequency and intensity
- Potential concerns worth clinical attention: persistent low mood, energy issues, isolation, anxiety, volatility
- Protective factors: activities, relationships, or circumstances associated with higher moods
- 2-3 suggested session topics a therapist might explore

Tone: Professional, observational, precise. Write as a clinical intake note, not self-help.
Use specific data points (dates, scores, quoted phrases from entries) to support observations.
Do not diagnose. Do not prescribe. Present observations and let the clinician draw conclusions.

IMPORTANT: Write in plain prose paragraphs only. Do NOT use markdown formatting — no headers (#), no bold (**), no bullet points (-), no numbered lists. Just flowing paragraphs with clear topic sentences.

Never use: "journey", "thrive", "delve", "insights", "growth", "amazing", "wonderful", "embrace"
Refer to the person by first name.`;

const MONTHLY_SYSTEM = `You are writing a private monthly reflection for someone who journals.
Read their entries from the past month and write a 200-300 word summary.

Format:
- One paragraph: the overall arc of the month — how it began, shifted, and ended
- One paragraph: recurring themes (emotional, situational, relational)
- One sentence: something specific they might not have noticed across the month

Tone: honest, observational, not cheerleading. Like a thoughtful editor reading their collected drafts.
Never use: "journey", "thrive", "growth mindset", "amazing", "wonderful", "embrace", "delve"
Use their first name once, naturally.`;

const SUMMARY_SYSTEM = `You are writing a private weekly reflection summary for someone who journals.
Read their entries from the past week and write a 150-200 word summary.

Format:
- One paragraph: what themes ran through the week (emotional, situational)
- One sentence: something specific they might not have noticed
- One sentence: how the week ended vs how it began

Tone: honest, observational, not cheerleading. Like a thoughtful editor reading their draft.
Never use: "journey", "thrive", "growth mindset", "amazing", "wonderful", "embrace", "delve"
Use their first name once, naturally.`;

export async function generateAcknowledgment(
  entryData: {
    mood_score: number | null;
    mood_label: string | null;
    prompt_question: string | null;
    prompt_answer: string | null;
    highlight: string | null;
    challenge: string | null;
    gratitude: string | null;
    free_write: string | null;
  },
  displayName: string,
  userId: string
): Promise<string> {
  const parts: string[] = [];
  if (entryData.mood_score)
    parts.push(
      `Mood: ${entryData.mood_score}/10 (${entryData.mood_label || ""})`
    );
  if (entryData.prompt_question && entryData.prompt_answer)
    parts.push(
      `Prompt "${entryData.prompt_question}": ${entryData.prompt_answer}`
    );
  if (entryData.highlight)
    parts.push(`Best part of the day: ${entryData.highlight}`);
  if (entryData.challenge)
    parts.push(`What felt hard: ${entryData.challenge}`);
  if (entryData.gratitude)
    parts.push(`Grateful for: ${entryData.gratitude}`);
  if (entryData.free_write) parts.push(`Free write: ${entryData.free_write}`);

  return generateText({
    model: ACKNOWLEDGMENT_MODEL,
    maxOutputTokens: 300,
    instructions: REFLECT_SYSTEM,
    input: `The person's name is ${normalizeDisplayName(displayName)}. Here is their journal entry for today:\n\n${truncateText(parts.join("\n\n"), 24_000)}`,
    userId,
  });
}

export async function generateWeeklySummary(
  entries: Array<{
    entry_date: string;
    mood_score: number | null;
    mood_label: string | null;
    highlight: string | null;
    challenge: string | null;
    gratitude: string | null;
    prompt_question: string | null;
    prompt_answer: string | null;
    free_write: string | null;
  }>,
  displayName: string,
  userId: string
): Promise<string> {
  const entrySummaries = joinSectionsWithinBudget(
    entries.map((entry) => {
      const parts: string[] = [`Date: ${entry.entry_date}`];
      if (entry.mood_score)
        parts.push(`Mood: ${entry.mood_score}/10 (${entry.mood_label})`);
      if (entry.highlight) parts.push(`Highlight: ${entry.highlight}`);
      if (entry.challenge) parts.push(`Challenge: ${entry.challenge}`);
      if (entry.gratitude) parts.push(`Grateful for: ${entry.gratitude}`);
      if (entry.prompt_answer)
        parts.push(`Prompt answer: ${entry.prompt_answer}`);
      if (entry.free_write) parts.push(`Free write: ${entry.free_write}`);
      return parts.join("\n");
    }),
    100_000
  );

  return generateText({
    model: INSIGHTS_MODEL,
    maxOutputTokens: 500,
    instructions: SUMMARY_SYSTEM,
    input: `The person's name is ${normalizeDisplayName(displayName)}. Here are their journal entries from the past week:\n\n${entrySummaries}`,
    userId,
  });
}

export async function generateMonthlySummary(
  entries: Array<{
    entry_date: string;
    mood_score: number | null;
    mood_label: string | null;
    highlight: string | null;
    challenge: string | null;
    gratitude: string | null;
    prompt_question: string | null;
    prompt_answer: string | null;
    free_write: string | null;
  }>,
  displayName: string,
  userId: string
): Promise<string> {
  const entrySummaries = joinSectionsWithinBudget(
    entries.map((entry) => {
      const parts: string[] = [`Date: ${entry.entry_date}`];
      if (entry.mood_score)
        parts.push(`Mood: ${entry.mood_score}/10 (${entry.mood_label})`);
      if (entry.highlight) parts.push(`Highlight: ${entry.highlight}`);
      if (entry.challenge) parts.push(`Challenge: ${entry.challenge}`);
      if (entry.gratitude) parts.push(`Grateful for: ${entry.gratitude}`);
      if (entry.prompt_answer)
        parts.push(`Prompt answer: ${entry.prompt_answer}`);
      if (entry.free_write) parts.push(`Free write: ${entry.free_write}`);
      return parts.join("\n");
    }),
    140_000
  );

  return generateText({
    model: INSIGHTS_MODEL,
    maxOutputTokens: 700,
    instructions: MONTHLY_SYSTEM,
    input: `The person's name is ${normalizeDisplayName(displayName)}. Here are their journal entries from the past month:\n\n${entrySummaries}`,
    userId,
  });
}

export async function generateTherapistSummary(
  entries: Array<{
    entry_date: string;
    mood_score: number | null;
    mood_label: string | null;
    mood_tags: string[] | null;
    highlight: string | null;
    challenge: string | null;
    gratitude: string | null;
    prompt_question: string | null;
    prompt_answer: string | null;
    free_write: string | null;
  }>,
  displayName: string,
  periodLabel: string,
  userId: string
): Promise<string> {
  const entrySummaries = joinSectionsWithinBudget(
    entries.map((entry) => {
      const parts: string[] = [`Date: ${entry.entry_date}`];
      if (entry.mood_score)
        parts.push(`Mood: ${entry.mood_score}/10 (${entry.mood_label})`);
      if (entry.mood_tags?.length)
        parts.push(`Tags: ${entry.mood_tags.join(", ")}`);
      if (entry.highlight) parts.push(`Highlight: ${entry.highlight}`);
      if (entry.challenge) parts.push(`Challenge: ${entry.challenge}`);
      if (entry.gratitude) parts.push(`Grateful for: ${entry.gratitude}`);
      if (entry.prompt_answer)
        parts.push(`Prompt answer: ${entry.prompt_answer}`);
      if (entry.free_write) parts.push(`Free write: ${entry.free_write}`);
      return parts.join("\n");
    }),
    160_000
  );

  return generateText({
    model: REPORT_MODEL,
    maxOutputTokens: 1200,
    instructions: THERAPIST_SYSTEM,
    input: `The person's name is ${normalizeDisplayName(displayName)}. The report covers ${periodLabel}.\n\nHere are their journal entries:\n\n${entrySummaries}`,
    userId,
  });
}
