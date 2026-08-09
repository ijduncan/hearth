export interface Profile {
  id: string;
  display_name: string;
  avatar_emoji: string;
  streak_count: number;
  last_entry_date: string | null;
  reminder_time: string;
  timezone: string;
  ai_enabled: boolean;
  created_at: string;
}

export interface Entry {
  id: string;
  user_id: string;
  entry_date: string;
  prompt_question: string | null;
  prompt_answer: string | null;
  highlight: string | null;
  challenge: string | null;
  gratitude: string | null;
  free_write: string | null;
  mood_score: number | null;
  mood_label: string | null;
  mood_tags: string[] | null;
  ai_acknowledgment: string | null;
  ai_generated_at: string | null;
  word_count: number | null;
  entry_duration_seconds: number | null;
  voice_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface WeeklySummary {
  id: string;
  user_id: string;
  week_start: string;
  week_end: string;
  summary_text: string;
  avg_mood: number | null;
  dominant_tags: string[] | null;
  created_at: string;
}

export interface MonthlySummary {
  id: string;
  user_id: string;
  month_start: string;
  month_end: string;
  summary_text: string;
  avg_mood: number | null;
  dominant_tags: string[] | null;
  total_entries: number | null;
  created_at: string;
}

export interface Prompt {
  category: string;
  text: string;
}

export interface PromptInteraction {
  id: string;
  user_id: string;
  prompt_text: string;
  prompt_category: string;
  interaction_type: "answered" | "skipped" | "shown";
  entry_date: string;
  created_at: string;
}

export const MOOD_LABELS: Record<number, string> = {
  1: "Rough",
  2: "Rough",
  3: "Meh",
  4: "Meh",
  5: "Okay",
  6: "Okay",
  7: "Good",
  8: "Good",
  9: "Great",
  10: "Brilliant",
};

export const MAX_MOOD_TAGS = 10;
export const MAX_MOOD_TAG_LENGTH = 40;

export const MOOD_TAGS = [
  "work",
  "family",
  "creative",
  "tired",
  "excited",
  "anxious",
  "grateful",
  "social",
  "body",
  "parenting",
  "calm",
  "overwhelmed",
  "lonely",
  "confident",
  "restless",
  "loved",
  "frustrated",
  "motivated",
  "sad",
  "playful",
  "focused",
  "scattered",
  "hopeful",
  "nostalgic",
  "proud",
  "guilty",
  "inspired",
  "numb",
  "romantic",
  "adventurous",
  "depressed",
  "content",
  "stressed",
  "curious",
  "irritable",
] as const;

export type MoodTag = (typeof MOOD_TAGS)[number];

export function getMoodLabel(score: number): string {
  return MOOD_LABELS[Math.round(score)] || "Okay";
}

export function getMoodColor(score: number): string {
  if (score <= 3) return "#EF4444";
  if (score <= 5) return "#F59E0B";
  if (score <= 7) return "#84CC16";
  return "#22C55E";
}
