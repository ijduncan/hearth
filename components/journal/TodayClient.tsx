"use client";

import { useMemo } from "react";
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

  const existingEntry = useMemo(
    () => recentEntries.find((e) => e.entry_date === localDateStr) || null,
    [recentEntries, localDateStr]
  );

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
          Good evening{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {formatter.format(localDate)}
        </p>
      </div>
      <EntryForm
        todaysPrompt={todaysPrompt}
        existingEntry={existingEntry}
        profileName={profile?.display_name || "friend"}
      />
    </div>
  );
}
