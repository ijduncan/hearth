"use client";

import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  getMoodLabel,
  getMoodColor,
  MAX_MOOD_TAG_LENGTH,
  MAX_MOOD_TAGS,
  MAX_SAVED_MOOD_TAGS,
  MOOD_TAGS,
  type SavedMoodTag,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMoodVocabulary } from "./MoodVocabularyProvider";

interface MoodSliderProps {
  value: number;
  onChange: (value: number) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  onTagSelect: (tag: string) => boolean;
}

type RetryAction =
  | { kind: "save"; label: string }
  | { kind: "delete"; tag: SavedMoodTag };

interface MutationError {
  message: string;
  retry: RetryAction;
}

function normalizeLabel(label: string) {
  return label.trim().replace(/\s+/g, " ");
}

function labelKey(label: string) {
  return label.toLowerCase();
}

export function MoodSlider({
  value,
  onChange,
  selectedTags,
  onTagToggle,
  onTagSelect,
}: MoodSliderProps) {
  const {
    savedTags,
    isRefreshing,
    loadError,
    refresh,
    saveTag,
    deleteTag,
  } = useMoodVocabulary();
  const customTagInputId = useId();
  const [customTag, setCustomTag] = useState("");
  const [savingLabel, setSavingLabel] = useState<string | null>(null);
  const [deletingIds, setDeletingIds] = useState<string[]>([]);
  const [statusMessage, setStatusMessage] = useState("");
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const selectedTagsRef = useRef(selectedTags);
  selectedTagsRef.current = selectedTags;

  const color = getMoodColor(value);
  const label = getMoodLabel(value);
  const isAtTagLimit = selectedTags.length >= MAX_MOOD_TAGS;
  const presetKeys = useMemo(
    () => new Set(MOOD_TAGS.map((tag) => labelKey(tag))),
    []
  );
  const savedTagKeys = useMemo(
    () => new Set(savedTags.map((tag) => labelKey(tag.label))),
    [savedTags]
  );
  const entryOnlyTags = selectedTags.filter((tag) => {
    const key = labelKey(tag);
    return !presetKeys.has(key) && !savedTagKeys.has(key);
  });

  const isSelected = (tag: string) =>
    selectedTags.some((selectedTag) => labelKey(selectedTag) === labelKey(tag));

  const handleTagToggle = (tag: string) => {
    if (!isSelected(tag) && isAtTagLimit) return;
    setMutationError(null);
    setStatusMessage("");
    onTagToggle(tag);
  };

  const performSave = async (requestedLabel: string) => {
    const normalizedLabel = normalizeLabel(requestedLabel);
    if (!normalizedLabel || savingLabel) return;

    setMutationError(null);
    setStatusMessage("");
    setSavingLabel(normalizedLabel);
    try {
      const savedTag = await saveTag(normalizedLabel);
      const selectedForToday = onTagSelect(savedTag.label);
      setCustomTag("");
      setStatusMessage(
        selectedForToday
          ? `Saved and selected “${savedTag.label}”.`
          : `Saved “${savedTag.label}” to Your words for later. You already have 10 words selected today.`
      );
    } catch (error) {
      setMutationError({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't save that word.",
        retry: { kind: "save", label: normalizedLabel },
      });
    } finally {
      setSavingLabel(null);
    }
  };

  const performDelete = async (tag: SavedMoodTag) => {
    if (deletingIds.includes(tag.id)) return;

    setMutationError(null);
    setStatusMessage("");
    setDeletingIds((currentIds) => [...currentIds, tag.id]);
    try {
      await deleteTag(tag.id);
      const remainsSelected = selectedTagsRef.current.some(
        (selectedTag) => labelKey(selectedTag) === labelKey(tag.label)
      );
      setStatusMessage(
        remainsSelected
          ? `Deleted “${tag.label}” from Your words. It remains selected for this entry only.`
          : `Deleted “${tag.label}” from Your words.`
      );
    } catch (error) {
      setMutationError({
        message:
          error instanceof Error
            ? error.message
            : "We couldn't delete that saved word.",
        retry: { kind: "delete", tag },
      });
    } finally {
      setDeletingIds((currentIds) =>
        currentIds.filter((id) => id !== tag.id)
      );
    }
  };

  const handleCustomTagSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedTag = normalizeLabel(customTag);
    if (!normalizedTag || savingLabel) return;

    const matchingPreset = MOOD_TAGS.find(
      (presetTag) => labelKey(presetTag) === labelKey(normalizedTag)
    );
    const matchingSavedTag = savedTags.find(
      (savedTag) => labelKey(savedTag.label) === labelKey(normalizedTag)
    );
    const canonicalLabel = matchingPreset ?? matchingSavedTag?.label;

    if (canonicalLabel) {
      const selectedForToday = onTagSelect(canonicalLabel);
      setCustomTag("");
      setMutationError(null);
      setStatusMessage(
        selectedForToday
          ? `Selected “${canonicalLabel}”.`
          : `“${canonicalLabel}” is already saved. Deselect a word to use it today.`
      );
      return;
    }

    void performSave(normalizedTag);
  };

  const retryMutation = () => {
    if (!mutationError) return;
    const action = mutationError.retry;
    setMutationError(null);
    if (action.kind === "save") {
      void performSave(action.label);
    } else {
      void performDelete(action.tag);
    }
  };

  const retryLoad = () => {
    void refresh().catch(() => {
      // The provider keeps the accessible error message for another retry.
    });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <p className="text-sm text-muted-foreground">How are you feeling?</p>
        <p
          className="font-serif text-3xl font-semibold transition-colors duration-300"
          style={{ color }}
        >
          {label}
        </p>
        <p className="text-sm tabular-nums text-muted-foreground">{value}/10</p>
      </div>

      <div className="px-2">
        <input
          type="range"
          aria-label="Mood score"
          aria-valuetext={`${label}, ${value} out of 10`}
          min={1}
          max={10}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full"
          style={{
            background:
              "linear-gradient(to right, #EF4444, #F59E0B 40%, #84CC16 70%, #22C55E)",
            accentColor: color,
          }}
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">Your words</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {savedTags.length}/{MAX_SAVED_MOOD_TAGS} saved
            </p>
          </div>

          {loadError ? (
            <div
              role="alert"
              className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              <span>{loadError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={retryLoad}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                Retry
              </Button>
            </div>
          ) : savedTags.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
              Add a word below and it will be here next time.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {savedTags.map((tag) => {
                const selected = isSelected(tag.label);
                const deleting = deletingIds.includes(tag.id);
                return (
                  <div
                    key={tag.id}
                    className="inline-flex min-h-11 overflow-hidden rounded-lg border border-border"
                  >
                    <button
                      type="button"
                      aria-pressed={selected}
                      disabled={!selected && isAtTagLimit}
                      onClick={() => handleTagToggle(tag.label)}
                      className={`min-h-11 px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted"
                      }`}
                    >
                      {tag.label}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${tag.label} from Your words`}
                      disabled={deleting}
                      onClick={() => void performDelete(tag)}
                      className="flex size-11 shrink-0 items-center justify-center border-l border-border bg-background text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-50"
                    >
                      {deleting ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {entryOnlyTags.length > 0 ? (
          <div className="space-y-2 rounded-lg bg-muted/50 p-3">
            <div>
              <p className="text-sm font-medium">For this entry only</p>
              <p className="text-xs text-muted-foreground">
                These words stay on this entry but will not appear in Your words
                next time.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {entryOnlyTags.map((tag) => (
                <button
                  key={labelKey(tag)}
                  type="button"
                  aria-label={`Remove ${tag} from this entry`}
                  onClick={() => handleTagToggle(tag)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-primary px-3 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {tag}
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Suggestions</p>
          <div className="flex flex-wrap gap-2">
            {MOOD_TAGS.map((tag) => {
              const selected = isSelected(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  disabled={!selected && isAtTagLimit}
                  onClick={() => handleTagToggle(tag)}
                  className={`min-h-11 rounded-full border px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? "border-transparent bg-primary text-primary-foreground"
                      : "border-border bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleCustomTagSubmit} className="space-y-2">
          <label
            htmlFor={customTagInputId}
            className="text-sm text-muted-foreground"
          >
            Add your own word
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={customTagInputId}
              value={customTag}
              onChange={(event) => setCustomTag(event.target.value)}
              maxLength={MAX_MOOD_TAG_LENGTH}
              placeholder="e.g. energized"
              disabled={Boolean(savingLabel)}
              className="h-11"
            />
            <Button
              type="submit"
              size="icon"
              aria-label={
                isAtTagLimit
                  ? "Save custom mood word for later"
                  : "Save and select custom mood word"
              }
              disabled={!customTag.trim() || Boolean(savingLabel)}
              className="size-11"
            >
              {savingLabel ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {isAtTagLimit
              ? "You have 10 selected. New words will still be saved here for later."
              : "New words are saved to Your words and selected for today."}
          </p>
        </form>

        {mutationError ? (
          <div
            role="alert"
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            <span>{mutationError.message}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryMutation}
            >
              <RotateCcw aria-hidden="true" />
              Retry
            </Button>
          </div>
        ) : null}

        <p aria-live="polite" className="min-h-4 text-xs text-muted-foreground">
          {statusMessage ||
            (isAtTagLimit ? "You can select up to 10 words." : "")}
        </p>
      </div>
    </div>
  );
}
