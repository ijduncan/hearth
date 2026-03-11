"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, ChevronRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { MoodSlider } from "./MoodSlider";
import { DailyPrompt } from "./DailyPrompt";
import { VoiceInput } from "./VoiceInput";
import { AISpark } from "./AISpark";
import type { Prompt, Entry } from "@/lib/types";

interface EntryFormProps {
  todaysPrompt: Prompt;
  existingEntry: Entry | null;
  profileName: string;
  entryDate?: string; // YYYY-MM-DD, defaults to today
  onSaved?: () => void;
}

type Step = "mood" | "questions" | "freewrite" | "submitting" | "done";

export function EntryForm({
  todaysPrompt,
  existingEntry,
  profileName,
  entryDate,
  onSaved,
}: EntryFormProps) {
  const [step, setStep] = useState<Step>(existingEntry ? "done" : "mood");
  const [moodScore, setMoodScore] = useState(existingEntry?.mood_score || 5);
  const [moodTags, setMoodTags] = useState<string[]>(existingEntry?.mood_tags || []);
  const [promptAnswer, setPromptAnswer] = useState(existingEntry?.prompt_answer || "");
  const [highlight, setHighlight] = useState(existingEntry?.highlight || "");
  const [challenge, setChallenge] = useState(existingEntry?.challenge || "");
  const [freeWrite, setFreeWrite] = useState(existingEntry?.free_write || "");
  const [aiAcknowledgment, setAiAcknowledgment] = useState(
    existingEntry?.ai_acknowledgment || ""
  );
  const [streakCount, setStreakCount] = useState(0);
  const startTime = useRef(Date.now());

  // Compute voice_used tracking
  const [voiceUsed, setVoiceUsed] = useState(false);

  const handleVoiceTranscript = (
    setter: React.Dispatch<React.SetStateAction<string>>
  ) => {
    return (text: string) => {
      setter((prev) => (prev ? prev + " " + text : text));
      setVoiceUsed(true);
    };
  };

  const handleTagToggle = (tag: string) => {
    setMoodTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    setStep("submitting");

    const wordCount = [promptAnswer, highlight, challenge, freeWrite]
      .filter(Boolean)
      .join(" ")
      .split(/\s+/)
      .filter(Boolean).length;

    const durationSeconds = Math.round((Date.now() - startTime.current) / 1000);

    try {
      const res = await fetch("/api/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: entryDate || new Date().toLocaleDateString("en-CA"), // YYYY-MM-DD in local tz
          mood_score: moodScore,
          mood_label: getMoodLabelLocal(moodScore),
          mood_tags: moodTags,
          prompt_question: todaysPrompt.text,
          prompt_answer: promptAnswer || null,
          highlight: highlight || null,
          challenge: challenge || null,
          free_write: freeWrite || null,
          word_count: wordCount,
          entry_duration_seconds: durationSeconds,
          voice_used: voiceUsed,
        }),
      });

      if (!res.ok) throw new Error("Failed to save entry");

      const data = await res.json();
      setAiAcknowledgment(data.ai_acknowledgment || "");
      setStreakCount(data.streak_count || 0);
      setStep("done");
      onSaved?.();
    } catch {
      // Allow retry
      setStep("freewrite");
    }
  };

  const slideVariants = {
    enter: { opacity: 0, x: 30 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 },
  };

  if (step === "done") {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-mood-high/10">
            <Check className="h-6 w-6 text-mood-high" />
          </div>
          <h2 className="text-xl font-serif">
            {entryDate && entryDate !== new Date().toLocaleDateString("en-CA")
              ? "Entry saved"
              : "Today\u0027s entry is saved"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {entryDate && entryDate !== new Date().toLocaleDateString("en-CA")
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
      <div className="flex flex-col items-center justify-center py-20 space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-serif">
          Sitting with what you wrote...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
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
                  onChange={setMoodScore}
                  selectedTags={moodTags}
                  onTagToggle={handleTagToggle}
                />
                <Button
                  onClick={() => setStep("questions")}
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
                <DailyPrompt prompt={todaysPrompt} />
                <div className="flex items-start gap-2">
                  <Textarea
                    placeholder="Your thoughts..."
                    value={promptAnswer}
                    onChange={(e) => setPromptAnswer(e.target.value)}
                    rows={3}
                    className="resize-none"
                  />
                  <VoiceInput
                    onTranscript={handleVoiceTranscript(setPromptAnswer)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Highlight */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="font-serif text-lg">
                  What was the best part of today?
                </p>
                <div className="flex items-start gap-2">
                  <Textarea
                    placeholder="Even something small..."
                    value={highlight}
                    onChange={(e) => setHighlight(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                  <VoiceInput
                    onTranscript={handleVoiceTranscript(setHighlight)}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Challenge */}
            <Card>
              <CardContent className="pt-6 space-y-3">
                <p className="font-serif text-lg">
                  What felt heavy or hard?
                </p>
                <div className="flex items-start gap-2">
                  <Textarea
                    placeholder="No judgement here..."
                    value={challenge}
                    onChange={(e) => setChallenge(e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                  <VoiceInput
                    onTranscript={handleVoiceTranscript(setChallenge)}
                  />
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setStep("mood")}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => setStep("freewrite")}
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
                <div className="flex items-start gap-2">
                  <Textarea
                    placeholder="Whatever comes to mind..."
                    value={freeWrite}
                    onChange={(e) => setFreeWrite(e.target.value)}
                    rows={5}
                    className="resize-none"
                  />
                  <VoiceInput
                    onTranscript={handleVoiceTranscript(setFreeWrite)}
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={() => setStep("questions")}
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
