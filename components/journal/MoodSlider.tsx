"use client";

import { useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import {
  getMoodLabel,
  getMoodColor,
  MAX_MOOD_TAG_LENGTH,
  MAX_MOOD_TAGS,
  MOOD_TAGS,
  type MoodTag,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MoodSliderProps {
  value: number;
  onChange: (value: number) => void;
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
}

export function MoodSlider({
  value,
  onChange,
  selectedTags,
  onTagToggle,
}: MoodSliderProps) {
  const [customTag, setCustomTag] = useState("");
  const color = getMoodColor(value);
  const label = getMoodLabel(value);
  const isAtTagLimit = selectedTags.length >= MAX_MOOD_TAGS;
  const customTags = selectedTags.filter(
    (selectedTag) =>
      !MOOD_TAGS.some(
        (presetTag) => presetTag.toLowerCase() === selectedTag.toLowerCase()
      )
  );

  const handleCustomTagSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const tag = customTag.trim().replace(/\s+/g, " ");
    if (!tag || isAtTagLimit) return;

    const matchingPreset = MOOD_TAGS.find(
      (presetTag) => presetTag.toLowerCase() === tag.toLowerCase()
    );
    const normalizedTag = matchingPreset ?? tag;
    const isAlreadySelected = selectedTags.some(
      (selectedTag) => selectedTag.toLowerCase() === normalizedTag.toLowerCase()
    );

    if (!isAlreadySelected) {
      onTagToggle(normalizedTag);
    }
    setCustomTag("");
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <p className="text-sm text-muted-foreground">How are you feeling?</p>
        <p
          className="text-3xl font-serif font-semibold transition-colors duration-300"
          style={{ color }}
        >
          {label}
        </p>
        <p className="text-sm text-muted-foreground tabular-nums">{value}/10</p>
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
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, #EF4444, #F59E0B 40%, #84CC16 70%, #22C55E)`,
            accentColor: color,
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>1</span>
          <span>10</span>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">What&apos;s on your mind?</p>
        <div className="flex flex-wrap gap-2">
          {MOOD_TAGS.map((tag: MoodTag) => (
            <Badge
              key={tag}
              render={<button type="button" />}
              variant={selectedTags.includes(tag) ? "default" : "outline"}
              aria-pressed={selectedTags.includes(tag)}
              aria-disabled={!selectedTags.includes(tag) && isAtTagLimit}
              className="cursor-pointer select-none transition-colors aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onClick={() => onTagToggle(tag)}
            >
              {tag}
            </Badge>
          ))}
          {customTags.map((tag) => (
            <Badge
              key={tag}
              render={<button type="button" />}
              aria-label={`Remove ${tag}`}
              className="cursor-pointer select-none"
              onClick={() => onTagToggle(tag)}
            >
              {tag}
              <X aria-hidden="true" />
            </Badge>
          ))}
        </div>

        <form
          onSubmit={handleCustomTagSubmit}
          className="flex items-center gap-2 pt-1"
        >
          <Input
            value={customTag}
            onChange={(event) => setCustomTag(event.target.value)}
            maxLength={MAX_MOOD_TAG_LENGTH}
            placeholder="Add your own word..."
            aria-label="Custom mood tag"
            disabled={isAtTagLimit}
            className="h-9"
          />
          <Button
            type="submit"
            size="icon"
            aria-label="Add custom mood tag"
            disabled={!customTag.trim() || isAtTagLimit}
            className="h-9 w-9"
          >
            <Plus aria-hidden="true" />
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {isAtTagLimit
            ? "You can select up to 10 words."
            : "Choose a word above or add your own."}
        </p>
      </div>
    </div>
  );
}
