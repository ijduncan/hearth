"use client";

import { getMoodLabel, getMoodColor, MOOD_TAGS, type MoodTag } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

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
  const color = getMoodColor(value);
  const label = getMoodLabel(value);

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
              variant={selectedTags.includes(tag) ? "default" : "outline"}
              className="cursor-pointer select-none transition-colors"
              onClick={() => onTagToggle(tag)}
            >
              {tag}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
