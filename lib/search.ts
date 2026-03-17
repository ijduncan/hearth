import type { ReactNode } from "react";
import { createElement } from "react";
import type { Entry } from "./types";

interface SearchResult {
  entry: Entry;
  score: number;
  matchedFields: string[];
}

const SEARCHABLE_FIELDS: { key: keyof Entry; label: string }[] = [
  { key: "highlight", label: "Highlight" },
  { key: "challenge", label: "Challenge" },
  { key: "gratitude", label: "Gratitude" },
  { key: "prompt_answer", label: "Prompt answer" },
  { key: "free_write", label: "Free write" },
  { key: "mood_label", label: "Mood" },
  { key: "ai_acknowledgment", label: "AI reflection" },
];

export function searchEntries(
  entries: Entry[],
  query: string,
  tag: string | null
): SearchResult[] {
  let results = entries;

  // Tag filter
  if (tag) {
    results = results.filter((e) => e.mood_tags?.includes(tag));
  }

  if (!query.trim()) {
    return results.map((entry) => ({ entry, score: 0, matchedFields: [] }));
  }

  const q = query.toLowerCase();

  const scored: SearchResult[] = [];
  for (const entry of results) {
    const matchedFields: string[] = [];
    for (const { key, label } of SEARCHABLE_FIELDS) {
      const value = entry[key];
      if (typeof value === "string" && value.toLowerCase().includes(q)) {
        matchedFields.push(label);
      }
    }
    if (matchedFields.length > 0) {
      scored.push({ entry, score: matchedFields.length, matchedFields });
    }
  }

  // Sort by relevance (more field matches = higher)
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Highlights matching text in a string by wrapping matches in <mark> elements.
 */
export function highlightText(text: string, query: string): ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let idx = lowerText.indexOf(lowerQuery, lastIndex);
  let key = 0;

  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx));
    }
    parts.push(
      createElement(
        "mark",
        { key: key++, className: "bg-primary/20 rounded-sm px-0.5" },
        text.slice(idx, idx + query.length)
      )
    );
    lastIndex = idx + query.length;
    idx = lowerText.indexOf(lowerQuery, lastIndex);
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}
