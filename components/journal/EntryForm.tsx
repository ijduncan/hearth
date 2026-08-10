"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { MoodSlider } from "./MoodSlider";
import { DailyPrompt } from "./DailyPrompt";

import { AISpark } from "./AISpark";
import {
  MAX_MOOD_TAGS,
  type Prompt,
  type Entry,
  type EntryDraft,
} from "@/lib/types";

interface EntryFormProps {
  todaysPrompt: Prompt;
  existingEntry: Entry | null;
  entryDate?: string; // YYYY-MM-DD, defaults to today
  onSaved?: () => void;
}

type Step = "mood" | "questions" | "freewrite" | "submitting" | "done";
type EditableStep = Exclude<Step, "submitting" | "done">;
type DraftSaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "restored"
  | "error"
  | "conflict";
type DraftSaveOutcome =
  | "saved"
  | "skipped"
  | "error"
  | "conflict"
  | "finalized";

interface DraftFormState {
  step: EditableStep;
  mood_score: number;
  mood_tags: string[];
  prompt_question: string;
  prompt_category: string;
  prompt_answer: string;
  highlight: string;
  challenge: string;
  gratitude: string;
  free_write: string;
  swap_count: number;
}

interface DraftRequestResult {
  outcome: "saved" | "conflict" | "finalized";
  accepted: boolean;
}

const AUTOSAVE_DELAY_MS = 1_000;
const AUTOSAVE_MAX_WAIT_MS = 5_000;
const DRAFT_KEEPALIVE_LIMIT_BYTES = 60 * 1_024;
const DRAFT_REQUEST_TIMEOUT_MS = 15_000;

function isEditableStep(value: unknown): value is EditableStep {
  return value === "mood" || value === "questions" || value === "freewrite";
}

export function EntryForm({
  todaysPrompt,
  existingEntry,
  entryDate,
  onSaved,
}: EntryFormProps) {
  const resolvedEntryDateRef = useRef(
    entryDate || new Date().toLocaleDateString("en-CA")
  );
  const resolvedEntryDate = resolvedEntryDateRef.current;
  const [step, setStep] = useState<Step>(existingEntry ? "done" : "mood");
  const [moodScore, setMoodScore] = useState(existingEntry?.mood_score ?? 5);
  const [moodTags, setMoodTags] = useState<string[]>(existingEntry?.mood_tags || []);
  const [promptAnswer, setPromptAnswer] = useState(existingEntry?.prompt_answer || "");
  const [highlight, setHighlight] = useState(existingEntry?.highlight || "");
  const [challenge, setChallenge] = useState(existingEntry?.challenge || "");
  const [gratitude, setGratitude] = useState(existingEntry?.gratitude || "");
  const [freeWrite, setFreeWrite] = useState(existingEntry?.free_write || "");
  const [aiAcknowledgment, setAiAcknowledgment] = useState(
    existingEntry?.ai_acknowledgment || ""
  );
  const [currentPrompt, setCurrentPrompt] = useState<Prompt>(todaysPrompt);
  const [swapCount, setSwapCount] = useState(0);
  const [swapping, setSwapping] = useState(false);
  const [streakCount, setStreakCount] = useState(0);
  const [hydrated, setHydrated] = useState(Boolean(existingEntry));
  const [hydrationError, setHydrationError] = useState("");
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const [saveStatus, setSaveStatus] = useState<DraftSaveStatus>("idle");
  const [submitError, setSubmitError] = useState("");
  const [changeVersion, setChangeVersion] = useState(0);
  const startTime = useRef(Date.now());
  const restoredDurationSeconds = useRef(0);
  const expectedRevisionRef = useRef<number | null>(null);
  const clientIdRef = useRef(globalThis.crypto.randomUUID());
  const clientSequenceRef = useRef(0);
  const lastAcceptedClientSequenceRef = useRef(0);
  const requestVersionBySequenceRef = useRef<Map<number, number>>(new Map());
  const lastPersistedChangeVersionRef = useRef(0);
  const lastFastLaneIssuedVersionRef = useRef(0);
  const hasMeaningfulInteractionRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const finalizingRef = useRef(false);
  const mountedRef = useRef(true);
  const changeVersionRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const promptSwapControllerRef = useRef<AbortController | null>(null);
  const promptAnswerRef = useRef(existingEntry?.prompt_answer || "");
  const formStateRef = useRef<DraftFormState>({
    step: "mood",
    mood_score: existingEntry?.mood_score ?? 5,
    mood_tags: existingEntry?.mood_tags || [],
    prompt_question: todaysPrompt.text,
    prompt_category: todaysPrompt.category,
    prompt_answer: existingEntry?.prompt_answer || "",
    highlight: existingEntry?.highlight || "",
    challenge: existingEntry?.challenge || "",
    gratitude: existingEntry?.gratitude || "",
    free_write: existingEntry?.free_write || "",
    swap_count: 0,
  });

  const cancelAutosaveTimers = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (maxWaitTimerRef.current) {
      clearTimeout(maxWaitTimerRef.current);
      maxWaitTimerRef.current = null;
    }
  }, []);

  const getDurationSeconds = useCallback(
    () =>
      Math.min(
        86_400,
        Math.max(
          0,
          restoredDurationSeconds.current +
            Math.round((Date.now() - startTime.current) / 1_000)
        )
      ),
    []
  );

  const reserveClientSequence = useCallback((snapshotVersion: number) => {
    if (clientSequenceRef.current >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Draft client sequence exhausted");
    }

    const clientSequence = clientSequenceRef.current + 1;
    clientSequenceRef.current = clientSequence;
    requestVersionBySequenceRef.current.set(clientSequence, snapshotVersion);
    return clientSequence;
  }, []);

  const sendDraftSnapshot = useCallback(
    async (
      capturedSnapshot: DraftFormState & { duration_seconds: number },
      clientSequence: number
    ): Promise<DraftRequestResult> => {
      const requestBody = JSON.stringify({
        entry_date: resolvedEntryDate,
        expected_revision: expectedRevisionRef.current,
        client_id: clientIdRef.current,
        client_sequence: clientSequence,
        ...capturedSnapshot,
      });
      const requestBytes = new TextEncoder().encode(requestBody).byteLength;
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        DRAFT_REQUEST_TIMEOUT_MS
      );

      let response: Response;
      try {
        response = await fetch("/api/entry-drafts", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          keepalive: requestBytes <= DRAFT_KEEPALIVE_LIMIT_BYTES,
          signal: controller.signal,
          body: requestBody,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 409) {
        const conflict = (await response.json().catch(() => null)) as {
          code?: unknown;
        } | null;
        requestVersionBySequenceRef.current.delete(clientSequence);
        return {
          outcome: conflict?.code === "finalized" ? "finalized" : "conflict",
          accepted: false,
        };
      }
      if (!response.ok) throw new Error("Draft save failed");

      const data = (await response.json()) as {
        draft: EntryDraft;
        applied: boolean;
        superseded: boolean;
      };
      const responseSequence = data.draft.last_client_sequence;
      if (
        data.draft.last_client_id !== clientIdRef.current ||
        !Number.isSafeInteger(responseSequence) ||
        responseSequence < 1 ||
        !Number.isInteger(data.draft.revision) ||
        data.draft.revision < 1
      ) {
        throw new Error("Draft save returned an invalid result");
      }

      const accepted =
        responseSequence >= lastAcceptedClientSequenceRef.current;
      if (accepted) {
        lastAcceptedClientSequenceRef.current = responseSequence;
        expectedRevisionRef.current = Math.max(
          expectedRevisionRef.current ?? 0,
          data.draft.revision
        );

        const persistedVersion =
          requestVersionBySequenceRef.current.get(responseSequence);
        if (persistedVersion !== undefined) {
          lastPersistedChangeVersionRef.current = Math.max(
            lastPersistedChangeVersionRef.current,
            persistedVersion
          );
        }
        if (
          lastPersistedChangeVersionRef.current >= changeVersionRef.current
        ) {
          pendingSaveRef.current = false;
        }

        for (const sequence of requestVersionBySequenceRef.current.keys()) {
          if (sequence <= responseSequence) {
            requestVersionBySequenceRef.current.delete(sequence);
          }
        }
      }

      return { outcome: "saved", accepted };
    },
    [resolvedEntryDate]
  );

  const enqueueDraftSave = useCallback(
    ({
      force = false,
      allowWhileFinalizing = false,
    }: {
      force?: boolean;
      allowWhileFinalizing?: boolean;
    } = {}): Promise<DraftSaveOutcome> => {
      cancelAutosaveTimers();

      if (
        !hydrated ||
        !hasMeaningfulInteractionRef.current ||
        (!pendingSaveRef.current && !force)
      ) {
        return saveQueueRef.current.then(() => "skipped");
      }

      pendingSaveRef.current = false;
      const versionBeingSaved = changeVersionRef.current;
      const formState = { ...formStateRef.current };
      let clientSequence: number;
      try {
        clientSequence = reserveClientSequence(versionBeingSaved);
      } catch {
        pendingSaveRef.current = true;
        if (mountedRef.current) setSaveStatus("error");
        return Promise.resolve("error");
      }

      const operation = saveQueueRef.current
        .catch(() => undefined)
        .then(async (): Promise<DraftSaveOutcome> => {
          if (finalizingRef.current && !allowWhileFinalizing) {
            requestVersionBySequenceRef.current.delete(clientSequence);
            return "skipped";
          }

          if (mountedRef.current) setSaveStatus("saving");

          try {
            const result = await sendDraftSnapshot(
              {
                ...formState,
                duration_seconds: getDurationSeconds(),
              },
              clientSequence
            );
            if (result.outcome === "conflict") {
              if (mountedRef.current) setSaveStatus("conflict");
              return "conflict";
            }
            if (result.outcome === "finalized") {
              // Another session may have finalized different words. Keep this
              // tab's text visible until final submission can compare hashes.
              if (mountedRef.current && !finalizingRef.current) {
                setSaveStatus("conflict");
              }
              return "finalized";
            }

            if (
              result.accepted &&
              mountedRef.current &&
              lastPersistedChangeVersionRef.current >=
                changeVersionRef.current &&
              !pendingSaveRef.current
            ) {
              setSaveStatus("saved");
            }
            return "saved";
          } catch {
            if (
              lastPersistedChangeVersionRef.current < changeVersionRef.current
            ) {
              pendingSaveRef.current = true;
              if (mountedRef.current) setSaveStatus("error");
            }
            return "error";
          }
        });

      saveQueueRef.current = operation.then(() => undefined);
      return operation;
    }, [
      cancelAutosaveTimers,
      getDurationSeconds,
      hydrated,
      reserveClientSequence,
      sendDraftSnapshot,
    ]
  );

  const saveDraftFastLane = useCallback(() => {
    cancelAutosaveTimers();

    const snapshotVersion = changeVersionRef.current;
    if (
      !hydrated ||
      !hasMeaningfulInteractionRef.current ||
      finalizingRef.current ||
      snapshotVersion <= lastPersistedChangeVersionRef.current ||
      snapshotVersion <= lastFastLaneIssuedVersionRef.current
    ) {
      return;
    }

    let clientSequence: number;
    try {
      clientSequence = reserveClientSequence(snapshotVersion);
    } catch {
      pendingSaveRef.current = true;
      if (mountedRef.current) setSaveStatus("error");
      return;
    }

    lastFastLaneIssuedVersionRef.current = snapshotVersion;
    pendingSaveRef.current = false;
    const capturedSnapshot = {
      ...formStateRef.current,
      duration_seconds: getDurationSeconds(),
    };

    void sendDraftSnapshot(capturedSnapshot, clientSequence)
      .then((result) => {
        if (!mountedRef.current) return;
        if (result.outcome === "conflict" || result.outcome === "finalized") {
          setSaveStatus("conflict");
          return;
        }
        if (
          result.accepted &&
          lastPersistedChangeVersionRef.current >= changeVersionRef.current &&
          !pendingSaveRef.current
        ) {
          setSaveStatus("saved");
        }
      })
      .catch(() => {
        if (
          lastPersistedChangeVersionRef.current < changeVersionRef.current
        ) {
          pendingSaveRef.current = true;
          if (lastFastLaneIssuedVersionRef.current === snapshotVersion) {
            lastFastLaneIssuedVersionRef.current =
              lastPersistedChangeVersionRef.current;
          }
          if (mountedRef.current) setSaveStatus("error");
        }
      });
  }, [
    cancelAutosaveTimers,
    getDurationSeconds,
    hydrated,
    reserveClientSequence,
    sendDraftSnapshot,
  ]);

  const scheduleAutosave = useCallback(() => {
    if (finalizingRef.current) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void enqueueDraftSave();
    }, AUTOSAVE_DELAY_MS);

    if (!maxWaitTimerRef.current) {
      maxWaitTimerRef.current = setTimeout(() => {
        maxWaitTimerRef.current = null;
        void enqueueDraftSave();
      }, AUTOSAVE_MAX_WAIT_MS);
    }
  }, [enqueueDraftSave]);

  const markMeaningfulInteraction = useCallback(() => {
    if (finalizingRef.current) return;
    hasMeaningfulInteractionRef.current = true;
    pendingSaveRef.current = true;
    changeVersionRef.current += 1;
    setChangeVersion((version) => version + 1);
    setSaveStatus("pending");
  }, []);

  const cancelPromptSwap = useCallback(() => {
    promptSwapControllerRef.current?.abort();
    promptSwapControllerRef.current = null;
    if (mountedRef.current) setSwapping(false);
  }, []);

  const updateDraftFormState = useCallback(
    (patch: Partial<DraftFormState>) => {
      formStateRef.current = { ...formStateRef.current, ...patch };
    },
    []
  );

  const moveToStep = useCallback(
    (nextStep: EditableStep) => {
      if (nextStep !== "questions") cancelPromptSwap();
      updateDraftFormState({ step: nextStep });
      setStep(nextStep);
      markMeaningfulInteraction();
    },
    [cancelPromptSwap, markMeaningfulInteraction, updateDraftFormState]
  );

  const reloadAfterConflict = useCallback(() => {
    const shouldReload = window.confirm(
      "Reloading will replace the words in this form with the saved version. Copy anything you want to keep first. Reload now?"
    );
    if (shouldReload) window.location.reload();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // A catch-up entry can unmount when its sheet closes without causing a
      // window blur, so send the latest pending snapshot before cleanup.
      saveDraftFastLane();
      promptSwapControllerRef.current?.abort();
      promptSwapControllerRef.current = null;
      mountedRef.current = false;
      cancelAutosaveTimers();
    };
  }, [cancelAutosaveTimers, saveDraftFastLane]);

  useEffect(() => {
    if (existingEntry) return;

    const controller = new AbortController();

    async function hydrateDraft() {
      setHydrationError("");
      try {
        const response = await fetch(
          `/api/entry-drafts?entry_date=${encodeURIComponent(resolvedEntryDate)}`,
          { signal: controller.signal, cache: "no-store" }
        );
        if (!response.ok) throw new Error("Draft restore failed");

        const data = (await response.json()) as {
          draft: EntryDraft | null;
          finalized: boolean;
        };
        if (controller.signal.aborted) return;

        startTime.current = Date.now();

        if (data.finalized) {
          setStep("done");
          setSaveStatus("idle");
          setHydrated(true);
          return;
        }

        const draft = data.draft;
        if (draft) {
          setStep(isEditableStep(draft.step) ? draft.step : "mood");
          setMoodScore(draft.mood_score ?? 5);
          setMoodTags(draft.mood_tags || []);
          setPromptAnswer(draft.prompt_answer || "");
          setHighlight(draft.highlight || "");
          setChallenge(draft.challenge || "");
          setGratitude(draft.gratitude || "");
          setFreeWrite(draft.free_write || "");
          setCurrentPrompt({
            text: draft.prompt_question || todaysPrompt.text,
            category: draft.prompt_category || todaysPrompt.category,
          });
          setSwapCount(draft.swap_count ?? 0);
          restoredDurationSeconds.current = draft.duration_seconds ?? 0;
          expectedRevisionRef.current = draft.revision;
          hasMeaningfulInteractionRef.current = true;
          setSaveStatus("restored");
        } else {
          restoredDurationSeconds.current = 0;
          expectedRevisionRef.current = null;
          hasMeaningfulInteractionRef.current = false;
          setSaveStatus("idle");
        }

        setHydrated(true);
      } catch (error) {
        if (controller.signal.aborted) return;
        setHydrationError(
          error instanceof Error
            ? "We couldn't restore your draft. Check your connection and try again."
            : "We couldn't restore your draft."
        );
      }
    }

    void hydrateDraft();
    return () => controller.abort();
  }, [
    existingEntry,
    hydrationAttempt,
    resolvedEntryDate,
    todaysPrompt.category,
    todaysPrompt.text,
  ]);

  useEffect(() => {
    if (!isEditableStep(step)) return;
    promptAnswerRef.current = promptAnswer;
    formStateRef.current = {
      step,
      mood_score: moodScore,
      mood_tags: moodTags,
      prompt_question: currentPrompt.text,
      prompt_category: currentPrompt.category,
      prompt_answer: promptAnswer,
      highlight,
      challenge,
      gratitude,
      free_write: freeWrite,
      swap_count: swapCount,
    };
  }, [
    challenge,
    currentPrompt.category,
    currentPrompt.text,
    freeWrite,
    gratitude,
    highlight,
    moodScore,
    moodTags,
    promptAnswer,
    step,
    swapCount,
  ]);

  useEffect(() => {
    if (!hydrated || changeVersion === 0) return;
    scheduleAutosave();
  }, [changeVersion, hydrated, scheduleAutosave]);

  useEffect(() => {
    const flushSerializedDraft = () => {
      void enqueueDraftSave();
    };
    const flushFastLaneDraft = () => {
      saveDraftFastLane();
    };
    const flushAndCancelSwapOnPageHide = () => {
      flushFastLaneDraft();
      cancelPromptSwap();
    };
    const flushFastLaneWhenHidden = () => {
      if (document.visibilityState === "hidden") flushFastLaneDraft();
    };

    window.addEventListener("blur", flushSerializedDraft);
    window.addEventListener("pagehide", flushAndCancelSwapOnPageHide);
    document.addEventListener("visibilitychange", flushFastLaneWhenHidden);
    return () => {
      window.removeEventListener("blur", flushSerializedDraft);
      window.removeEventListener("pagehide", flushAndCancelSwapOnPageHide);
      document.removeEventListener("visibilitychange", flushFastLaneWhenHidden);
    };
  }, [cancelPromptSwap, enqueueDraftSave, saveDraftFastLane]);

  const handlePromptSwap = useCallback(async () => {
    if (swapCount >= 3 || swapping || promptSwapControllerRef.current) return;
    if (
      promptAnswer.length > 0 &&
      !window.confirm(
        "Trying a different question will clear your current answer. Continue?"
      )
    ) {
      return;
    }

    const answerAtSwapStart = promptAnswerRef.current;
    const controller = new AbortController();
    promptSwapControllerRef.current = controller;
    setSwapping(true);
    try {
      const res = await fetch("/api/ai/prompts/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          entry_date: resolvedEntryDate,
          skipped_prompt_text: currentPrompt.text,
          skipped_prompt_category: currentPrompt.category,
        }),
      });
      if (res.ok) {
        const newPrompt = (await res.json()) as Prompt;
        if (
          controller.signal.aborted ||
          promptSwapControllerRef.current !== controller ||
          !mountedRef.current ||
          finalizingRef.current ||
          formStateRef.current.step !== "questions" ||
          promptAnswerRef.current !== answerAtSwapStart
        ) {
          return;
        }

        updateDraftFormState({
          prompt_question: newPrompt.text,
          prompt_category: newPrompt.category,
          prompt_answer: "",
          swap_count: swapCount + 1,
        });
        setCurrentPrompt(newPrompt);
        setSwapCount((c) => c + 1);
        promptAnswerRef.current = "";
        setPromptAnswer("");
        markMeaningfulInteraction();
      }
    } catch {
      // Keep the current question and answer when a swap request fails.
    } finally {
      if (promptSwapControllerRef.current === controller) {
        promptSwapControllerRef.current = null;
        if (mountedRef.current) setSwapping(false);
      }
    }
  }, [
    currentPrompt,
    markMeaningfulInteraction,
    promptAnswer,
    resolvedEntryDate,
    swapCount,
    swapping,
    updateDraftFormState,
  ]);

  const handleMoodChange = useCallback(
    (value: number) => {
      updateDraftFormState({ mood_score: value });
      setMoodScore(value);
      markMeaningfulInteraction();
    },
    [markMeaningfulInteraction, updateDraftFormState]
  );

  const handleTagToggle = useCallback(
    (tag: string) => {
      const isSelected = moodTags.includes(tag);
      if (!isSelected && moodTags.length >= MAX_MOOD_TAGS) return;

      const nextTags = isSelected
        ? moodTags.filter((item) => item !== tag)
        : [...moodTags, tag];
      updateDraftFormState({ mood_tags: nextTags });
      setMoodTags(nextTags);
      markMeaningfulInteraction();
    },
    [markMeaningfulInteraction, moodTags, updateDraftFormState]
  );

  const handleSubmit = async () => {
    if (finalizingRef.current) return;

    cancelPromptSwap();
    setSubmitError("");
    finalizingRef.current = true;
    cancelAutosaveTimers();
    setStep("submitting");

    const draftOutcome = await enqueueDraftSave({
      force: true,
      allowWhileFinalizing: true,
    });
    if (draftOutcome === "conflict") {
      finalizingRef.current = false;
      setSubmitError(
        "This draft changed or was finished somewhere else. Reload before saving."
      );
      setStep("freewrite");
      return;
    }
    if (draftOutcome === "error") {
      finalizingRef.current = false;
      setSubmitError(
        "We couldn't safely save your draft yet. Check your connection and try again."
      );
      setStep("freewrite");
      return;
    }

    const wordCount = [promptAnswer, highlight, challenge, gratitude, freeWrite]
      .filter(Boolean)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;

    const durationSeconds = getDurationSeconds();

    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: resolvedEntryDate,
          draft_revision: expectedRevisionRef.current,
          mood_score: moodScore,
          mood_label: getMoodLabelLocal(moodScore),
          mood_tags: moodTags,
          prompt_question: currentPrompt.text,
          prompt_category: currentPrompt.category,
          prompt_answer: promptAnswer || null,
          highlight: highlight || null,
          challenge: challenge || null,
          gratitude: gratitude || null,
          free_write: freeWrite || null,
          word_count: wordCount,
          entry_duration_seconds: durationSeconds,
          voice_used: false,
        }),
      });

      if (res.status === 409) {
        finalizingRef.current = false;
        setSaveStatus("conflict");
        setSubmitError(
          "This entry differs from the version already saved. Copy anything you want to keep, then reload to review it."
        );
        setStep("freewrite");
        return;
      }
      if (!res.ok) throw new Error("Failed to save entry");

      const data = await res.json();
      setAiAcknowledgment(data.ai_acknowledgment || "");
      setStreakCount(data.streak_count || 0);
      setStep("done");
      onSaved?.();
    } catch {
      finalizingRef.current = false;
      setSubmitError(
        "We couldn't confirm that your entry finished. Your writing is still here—please try again."
      );
      setStep("freewrite");
    }
  };

  const slideVariants = {
    enter: { opacity: 0, x: 30 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 },
  };

  if (!hydrated) {
    if (hydrationError) {
      return (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <p role="alert" className="text-sm text-destructive">
              {hydrationError}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setHydrationError("");
                setHydrationAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      );
    }

    return (
      <div
        className="flex flex-col items-center justify-center gap-3 py-20"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Restoring your draft...</p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-mood-high/10">
            <Check className="h-6 w-6 text-mood-high" />
          </div>
          <h2 className="text-xl font-serif">
            {resolvedEntryDate !== new Date().toLocaleDateString("en-CA")
              ? "Entry saved"
              : "Today\u0027s entry is saved"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {resolvedEntryDate !== new Date().toLocaleDateString("en-CA")
              ? "Nice work catching up."
              : "Come back tomorrow evening."}
          </p>
        </div>
        {aiAcknowledgment && (
          <AISpark
            acknowledgment={aiAcknowledgment}
            streakCount={streakCount}
          />
        )}
      </div>
    );
  }

  if (step === "submitting") {
    return (
      <div
        className="flex flex-col items-center justify-center py-20 space-y-4"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-serif">
          Sitting with what you wrote...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div
        className={`flex min-h-6 items-center justify-end gap-2 text-xs ${
          saveStatus === "error" || saveStatus === "conflict"
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {saveStatus === "pending" && <span>Changes not saved yet</span>}
        {saveStatus === "saving" && (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            Saving...
          </span>
        )}
        {saveStatus === "saved" && <span>Draft saved</span>}
        {saveStatus === "restored" && <span>Draft restored</span>}
        {saveStatus === "error" && (
          <>
            <span>Draft not saved</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void enqueueDraftSave({ force: true })}
            >
              Retry
            </Button>
          </>
        )}
        {saveStatus === "conflict" && (
          <>
            <span>Draft changed somewhere else</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={reloadAfterConflict}
            >
              Reload
            </Button>
          </>
        )}
      </div>
      <AnimatePresence mode="wait">
        {step === "mood" && (
          <motion.div
            key="mood"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card>
              <CardContent className="pt-6 space-y-6">
                <MoodSlider
                  value={moodScore}
                  onChange={handleMoodChange}
                  selectedTags={moodTags}
                  onTagToggle={handleTagToggle}
                />
                <Button
                  onClick={() => moveToStep("questions")}
                  className="w-full"
                >
                  Continue <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {step === "questions" && (
          <motion.div
            key="questions"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
            className="space-y-4"
          >
            {/* Daily Prompt */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <DailyPrompt
                  prompt={currentPrompt}
                  onSwap={handlePromptSwap}
                  swapCount={swapCount}
                  swapping={swapping}
                />
                <Textarea
                  aria-label={currentPrompt.text}
                  placeholder="Your thoughts..."
                  value={promptAnswer}
                  maxLength={5_000}
                  onChange={(event) => {
                    promptAnswerRef.current = event.target.value;
                    updateDraftFormState({
                      prompt_answer: event.target.value,
                    });
                    setPromptAnswer(event.target.value);
                    markMeaningfulInteraction();
                  }}
                  rows={3}
                  className="resize-none"
                />
              </CardContent>
            </Card>

            {/* Highlight */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="font-serif text-lg">
                  What was the best part of today?
                </p>
                <Textarea
                  aria-label="What was the best part of today?"
                  placeholder="Even something small..."
                  value={highlight}
                  maxLength={2_000}
                  onChange={(event) => {
                    updateDraftFormState({ highlight: event.target.value });
                    setHighlight(event.target.value);
                    markMeaningfulInteraction();
                  }}
                  rows={2}
                  className="resize-none"
                />
              </CardContent>
            </Card>

            {/* Challenge */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="font-serif text-lg">
                  What felt heavy or hard?
                </p>
                <Textarea
                  aria-label="What felt heavy or hard?"
                  placeholder="No judgement here..."
                  value={challenge}
                  maxLength={2_000}
                  onChange={(event) => {
                    updateDraftFormState({ challenge: event.target.value });
                    setChallenge(event.target.value);
                    markMeaningfulInteraction();
                  }}
                  rows={2}
                  className="resize-none"
                />
              </CardContent>
            </Card>

            {/* Gratitude */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="font-serif text-lg">
                  What are you grateful for?
                </p>
                <Textarea
                  aria-label="What are you grateful for?"
                  placeholder="Big or small..."
                  value={gratitude}
                  maxLength={2_000}
                  onChange={(event) => {
                    updateDraftFormState({ gratitude: event.target.value });
                    setGratitude(event.target.value);
                    markMeaningfulInteraction();
                  }}
                  rows={2}
                  className="resize-none"
                />
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => moveToStep("mood")}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => moveToStep("freewrite")}
                disabled={swapping}
                className="flex-1"
              >
                Continue <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </motion.div>
        )}

        {step === "freewrite" && (
          <motion.div
            key="freewrite"
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3 }}
          >
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div>
                  <p className="font-serif text-lg mb-1">
                    Anything else?
                  </p>
                  <p className="text-sm text-muted-foreground">
                    This space is just yours. Write as much or as little as
                    you&apos;d like.
                  </p>
                </div>
                <Textarea
                  aria-label="Anything else?"
                  placeholder="Whatever comes to mind..."
                  value={freeWrite}
                  maxLength={20_000}
                  onChange={(event) => {
                    updateDraftFormState({ free_write: event.target.value });
                    setFreeWrite(event.target.value);
                    markMeaningfulInteraction();
                  }}
                  rows={5}
                  className="resize-none"
                />
                {submitError && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    <p>{submitError}</p>
                    {saveStatus === "conflict" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-1"
                        onClick={reloadAfterConflict}
                      >
                        Reload draft
                      </Button>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => moveToStep("questions")}
                    className="flex-1"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    className="flex-1"
                  >
                    Save entry
                  </Button>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getMoodLabelLocal(score: number): string {
  const labels: Record<number, string> = {
    1: "Rough", 2: "Rough", 3: "Meh", 4: "Meh",
    5: "Okay", 6: "Okay", 7: "Good", 8: "Good",
    9: "Great", 10: "Brilliant",
  };
  return labels[Math.round(score)] || "Okay";
}
