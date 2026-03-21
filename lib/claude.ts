import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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
  displayName: string
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
  if (entryData.highlight) parts.push(`Best part of the day: ${entryData.highlight}`);
  if (entryData.challenge) parts.push(`What felt hard: ${entryData.challenge}`);
  if (entryData.gratitude) parts.push(`Grateful for: ${entryData.gratitude}`);
  if (entryData.free_write) parts.push(`Free write: ${entryData.free_write}`);

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 300,
    system: REFLECT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `The person's name is ${displayName}. Here is their journal entry for today:\n\n${parts.join("\n\n")}`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
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
  displayName: string
): Promise<string> {
  const entrySummaries = entries
    .map((e) => {
      const parts: string[] = [`Date: ${e.entry_date}`];
      if (e.mood_score) parts.push(`Mood: ${e.mood_score}/10 (${e.mood_label})`);
      if (e.highlight) parts.push(`Highlight: ${e.highlight}`);
      if (e.challenge) parts.push(`Challenge: ${e.challenge}`);
      if (e.gratitude) parts.push(`Grateful for: ${e.gratitude}`);
      if (e.prompt_answer) parts.push(`Prompt answer: ${e.prompt_answer}`);
      if (e.free_write) parts.push(`Free write: ${e.free_write}`);
      return parts.join("\n");
    })
    .join("\n---\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `The person's name is ${displayName}. Here are their journal entries from the past week:\n\n${entrySummaries}`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
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
  displayName: string
): Promise<string> {
  const entrySummaries = entries
    .map((e) => {
      const parts: string[] = [`Date: ${e.entry_date}`];
      if (e.mood_score) parts.push(`Mood: ${e.mood_score}/10 (${e.mood_label})`);
      if (e.highlight) parts.push(`Highlight: ${e.highlight}`);
      if (e.challenge) parts.push(`Challenge: ${e.challenge}`);
      if (e.gratitude) parts.push(`Grateful for: ${e.gratitude}`);
      if (e.prompt_answer) parts.push(`Prompt answer: ${e.prompt_answer}`);
      if (e.free_write) parts.push(`Free write: ${e.free_write}`);
      return parts.join("\n");
    })
    .join("\n---\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 700,
    system: MONTHLY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `The person's name is ${displayName}. Here are their journal entries from the past month:\n\n${entrySummaries}`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
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
  periodLabel: string
): Promise<string> {
  const entrySummaries = entries
    .map((e) => {
      const parts: string[] = [`Date: ${e.entry_date}`];
      if (e.mood_score) parts.push(`Mood: ${e.mood_score}/10 (${e.mood_label})`);
      if (e.mood_tags?.length) parts.push(`Tags: ${e.mood_tags.join(", ")}`);
      if (e.highlight) parts.push(`Highlight: ${e.highlight}`);
      if (e.challenge) parts.push(`Challenge: ${e.challenge}`);
      if (e.gratitude) parts.push(`Grateful for: ${e.gratitude}`);
      if (e.prompt_answer) parts.push(`Prompt answer: ${e.prompt_answer}`);
      if (e.free_write) parts.push(`Free write: ${e.free_write}`);
      return parts.join("\n");
    })
    .join("\n---\n");

  const message = await anthropic.messages.create({
    model: "claude-opus-4-6-20250415",
    max_tokens: 1200,
    system: THERAPIST_SYSTEM,
    messages: [
      {
        role: "user",
        content: `The person's name is ${displayName}. The report covers ${periodLabel}.\n\nHere are their journal entries:\n\n${entrySummaries}`,
      },
    ],
  });

  const block = message.content[0];
  return block.type === "text" ? block.text : "";
}
