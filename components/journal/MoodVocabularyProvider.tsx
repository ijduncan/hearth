"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SavedMoodTag } from "@/lib/types";

interface MoodVocabularyContextValue {
  savedTags: SavedMoodTag[];
  isRefreshing: boolean;
  loadError: string | null;
  refresh: () => Promise<void>;
  saveTag: (label: string) => Promise<SavedMoodTag>;
  deleteTag: (id: string) => Promise<void>;
}

const MoodVocabularyContext = createContext<MoodVocabularyContextValue | null>(
  null
);

function isSavedMoodTag(value: unknown): value is SavedMoodTag {
  if (!value || typeof value !== "object") return false;
  const tag = value as Record<string, unknown>;
  return (
    typeof tag.id === "string" &&
    typeof tag.user_id === "string" &&
    typeof tag.label === "string" &&
    typeof tag.created_at === "string"
  );
}

function deduplicateTags(tags: SavedMoodTag[]) {
  const labels = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.label.toLowerCase();
    if (labels.has(key)) return false;
    labels.add(key);
    return true;
  });
}

function requestError(response: Response, action: "load" | "save" | "delete") {
  if (response.status === 401 || response.status === 403) {
    return new Error("Your session expired. Refresh the page and sign in again.");
  }
  if (response.status === 429) {
    return new Error("Too many changes at once. Wait a moment and try again.");
  }
  if (action === "save" && response.status === 409) {
    return new Error(
      "You can save up to 100 words. Delete one before adding another."
    );
  }
  if (action === "save" && response.status === 400) {
    return new Error("Enter a word between 1 and 40 characters.");
  }

  if (action === "load") {
    return new Error("We couldn't load your saved words.");
  }
  if (action === "delete") {
    return new Error("We couldn't delete that saved word.");
  }
  return new Error("We couldn't save that word.");
}

export function MoodVocabularyProvider({
  initialTags,
  initialLoadFailed = false,
  children,
}: {
  initialTags: SavedMoodTag[];
  initialLoadFailed?: boolean;
  children: ReactNode;
}) {
  const [savedTags, setSavedTags] = useState(() =>
    deduplicateTags(initialTags)
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(
    initialLoadFailed ? "We couldn't load your saved words." : null
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/mood-tags", { cache: "no-store" });
      if (!response.ok) throw requestError(response, "load");

      const data = (await response.json()) as { tags?: unknown };
      if (!Array.isArray(data.tags) || !data.tags.every(isSavedMoodTag)) {
        throw new Error("We couldn't load your saved words.");
      }

      setSavedTags(deduplicateTags(data.tags));
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "We couldn't load your saved words."
      );
      throw error;
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const saveTag = useCallback(async (label: string) => {
    const response = await fetch("/api/mood-tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label }),
    });
    if (!response.ok) throw requestError(response, "save");

    const data = (await response.json()) as { tag?: unknown };
    if (!isSavedMoodTag(data.tag)) {
      throw new Error("We couldn't save that word.");
    }
    const savedTag = data.tag;

    setSavedTags((currentTags) => {
      const matchingIndex = currentTags.findIndex(
        (tag) => tag.label.toLowerCase() === savedTag.label.toLowerCase()
      );
      if (matchingIndex === -1) return [...currentTags, savedTag];

      return currentTags.map((tag, index) =>
        index === matchingIndex ? savedTag : tag
      );
    });
    return savedTag;
  }, []);

  const deleteTag = useCallback(async (id: string) => {
    const response = await fetch(`/api/mood-tags/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw requestError(response, "delete");

    setSavedTags((currentTags) => currentTags.filter((tag) => tag.id !== id));
  }, []);

  const value = useMemo(
    () => ({
      savedTags,
      isRefreshing,
      loadError,
      refresh,
      saveTag,
      deleteTag,
    }),
    [deleteTag, isRefreshing, loadError, refresh, saveTag, savedTags]
  );

  return (
    <MoodVocabularyContext.Provider value={value}>
      {children}
    </MoodVocabularyContext.Provider>
  );
}

export function useMoodVocabulary() {
  const value = useContext(MoodVocabularyContext);
  if (!value) {
    throw new Error(
      "useMoodVocabulary must be used inside MoodVocabularyProvider"
    );
  }
  return value;
}
