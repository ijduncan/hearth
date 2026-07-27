"use client";

import { getTodaysPrompt } from "@/lib/prompts";
import { EntryForm } from "./EntryForm";
import type { Profile, Entry } from "@/lib/types";

interface TodayClientProps {
  profile: Profile | null;
  recentEntries: Entry[];
}

export function TodayClient({ profile, recentEntries }: TodayClientProps) {
  const localDate = new Date();
  const localDateStr = localDate.toLocaleDateString("en-CA"); // YYYY-MM-DD

  const existingEntry =
    recentEntries.find((e) => e.entry_date === localDateStr) || null;

  const todaysPrompt = getTodaysPrompt(localDate);

  const formatter = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-serif font-semibold">
          {getGreeting(localDate)}
          {profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatter.format(localDate)}
        </p>
      </div>
      <EntryForm
        todaysPrompt={todaysPrompt}
        existingEntry={existingEntry}
      />
    </div>
  );
}

function getGreeting(date: Date): string {
  const hour = date.getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
