"use client";

import { useState, useMemo, useEffect } from "react";
import {
  format,
  parseISO,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isBefore,
  addMonths,
  subMonths,
  getDay,
  startOfDay,
} from "date-fns";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { getMoodColor, MOOD_TAGS } from "@/lib/types";
import { getTodaysPrompt } from "@/lib/prompts";
import { EntryForm } from "@/components/journal/EntryForm";
import type { Entry } from "@/lib/types";
import { searchEntries, highlightText } from "@/lib/search";

interface HistoryViewProps {
  entries: Entry[];
  profileName?: string;
  onEntrySaved?: () => void;
}

export function HistoryView({ entries, profileName = "friend", onEntrySaved }: HistoryViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [catchUpDate, setCatchUpDate] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const entryMap = useMemo(() => {
    const map = new Map<string, Entry>();
    entries.forEach((e) => map.set(e.entry_date, e));
    return map;
  }, [entries]);

  const searchResults = useMemo(
    () => searchEntries(entries, debouncedQuery, filterTag),
    [entries, debouncedQuery, filterTag]
  );

  // Calendar grid
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startDayOfWeek = getDay(monthStart); // 0=Sun
  const paddingDays = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1; // Monday start

  return (
    <div className="space-y-6">
      {/* Search and filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search entries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {MOOD_TAGS.map((tag) => (
            <Badge
              key={tag}
              variant={filterTag === tag ? "default" : "outline"}
              className="cursor-pointer select-none"
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
            >
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      {/* Calendar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium">
              {format(currentMonth, "MMMM yyyy")}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 text-center mb-2">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="text-xs text-muted-foreground py-1">
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: paddingDays }).map((_, i) => (
              <div key={`pad-${i}`} />
            ))}
            {days.map((day) => {
              const dateStr = format(day, "yyyy-MM-dd");
              const entry = entryMap.get(dateStr);
              const isToday = isSameDay(day, new Date());
              const isPast = isBefore(startOfDay(day), startOfDay(new Date()));
              const isMissed = !entry && isPast;

              return (
                <button
                  key={dateStr}
                  onClick={() => {
                    if (entry) {
                      setSelectedEntry(entry);
                    } else if (isMissed) {
                      setCatchUpDate(dateStr);
                    }
                  }}
                  className={`relative h-10 rounded-md text-sm flex items-center justify-center transition-colors ${
                    isToday ? "ring-1 ring-primary" : ""
                  } ${entry ? "hover:bg-muted cursor-pointer" : isMissed ? "hover:bg-muted/50 cursor-pointer text-muted-foreground" : "text-muted-foreground/40"}`}
                >
                  {format(day, "d")}
                  {entry && entry.mood_score && (
                    <span
                      className="absolute bottom-1 h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: getMoodColor(entry.mood_score) }}
                    />
                  )}
                  {isMissed && (
                    <span className="absolute bottom-1 h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                  )}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Search results (if searching) */}
      {(debouncedQuery || filterTag) && (
        <div className="space-y-3">
          {searchResults.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {searchResults.length} result{searchResults.length !== 1 ? "s" : ""}
                {debouncedQuery && filterTag && (
                  <span>
                    {" "}for &ldquo;{debouncedQuery}&rdquo; + {filterTag}
                  </span>
                )}
              </p>
              {searchResults.map(({ entry, matchedFields }) => (
                <Card
                  key={entry.id}
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setSelectedEntry(entry)}
                >
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">
                        {format(parseISO(entry.entry_date), "EEEE, MMM d")}
                      </span>
                      {entry.mood_score && (
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: getMoodColor(entry.mood_score) + "20",
                            color: getMoodColor(entry.mood_score),
                          }}
                        >
                          {entry.mood_label} {entry.mood_score}/10
                        </span>
                      )}
                    </div>
                    {/* Show first matching field with highlight */}
                    {debouncedQuery && matchedFields.length > 0 && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        <span className="text-xs font-medium text-muted-foreground/70">
                          {matchedFields[0]}:
                        </span>{" "}
                        {highlightText(
                          getFieldPreview(entry, matchedFields[0]) || "",
                          debouncedQuery
                        )}
                      </p>
                    )}
                    {!debouncedQuery && entry.highlight && (
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {entry.highlight}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">
                No entries match your search.
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Try different words or clear the filters.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Catch-up entry drawer */}
      <Sheet
        open={!!catchUpDate}
        onOpenChange={(open) => !open && setCatchUpDate(null)}
      >
        <SheetContent className="overflow-y-auto px-6">
          {catchUpDate && (
            <>
              <SheetHeader>
                <SheetTitle className="font-serif">
                  {format(parseISO(catchUpDate), "EEEE, MMMM d")}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <EntryForm
                  todaysPrompt={getTodaysPrompt(parseISO(catchUpDate))}
                  existingEntry={null}
                  profileName={profileName}
                  entryDate={catchUpDate}
                  onSaved={() => {
                    setCatchUpDate(null);
                    onEntrySaved?.();
                  }}
                />
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Entry drawer */}
      <Sheet
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      >
        <SheetContent className="overflow-y-auto px-6">
          {selectedEntry && (
            <>
              <SheetHeader>
                <SheetTitle className="font-serif">
                  {format(parseISO(selectedEntry.entry_date), "EEEE, MMMM d")}
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-6 mt-6">
                {selectedEntry.mood_score && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Mood</p>
                    <p
                      className="text-lg font-semibold"
                      style={{ color: getMoodColor(selectedEntry.mood_score) }}
                    >
                      {selectedEntry.mood_label} — {selectedEntry.mood_score}/10
                    </p>
                    {selectedEntry.mood_tags && selectedEntry.mood_tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {selectedEntry.mood_tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedEntry.prompt_question && selectedEntry.prompt_answer && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      {selectedEntry.prompt_question}
                    </p>
                    <p className="text-sm">{selectedEntry.prompt_answer}</p>
                  </div>
                )}

                {selectedEntry.highlight && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Best part of the day
                    </p>
                    <p className="text-sm">{selectedEntry.highlight}</p>
                  </div>
                )}

                {selectedEntry.challenge && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      What felt hard
                    </p>
                    <p className="text-sm">{selectedEntry.challenge}</p>
                  </div>
                )}

                {selectedEntry.gratitude && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Grateful for
                    </p>
                    <p className="text-sm">{selectedEntry.gratitude}</p>
                  </div>
                )}

                {selectedEntry.free_write && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">
                      Free write
                    </p>
                    <p className="text-sm whitespace-pre-line">
                      {selectedEntry.free_write}
                    </p>
                  </div>
                )}

                {selectedEntry.ai_acknowledgment && (
                  <div className="rounded-lg bg-primary/5 border border-primary/10 p-4">
                    <p className="text-xs text-primary/60 mb-2">AI reflection</p>
                    <p className="text-sm font-serif leading-relaxed">
                      {selectedEntry.ai_acknowledgment}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

const FIELD_LABEL_MAP: Record<string, keyof Entry> = {
  "Highlight": "highlight",
  "Challenge": "challenge",
  "Gratitude": "gratitude",
  "Prompt answer": "prompt_answer",
  "Free write": "free_write",
  "Mood": "mood_label",
  "AI reflection": "ai_acknowledgment",
};

function getFieldPreview(entry: Entry, fieldLabel: string): string | null {
  const key = FIELD_LABEL_MAP[fieldLabel];
  if (!key) return null;
  const value = entry[key];
  return typeof value === "string" ? value : null;
}
