"use client";

import { useRouter } from "next/navigation";
import { HistoryView } from "./HistoryView";
import type { Entry } from "@/lib/types";

interface HistoryClientProps {
  entries: Entry[];
  profileName: string;
}

export function HistoryClient({ entries, profileName }: HistoryClientProps) {
  const router = useRouter();

  return (
    <HistoryView
      entries={entries}
      profileName={profileName}
      onEntrySaved={() => router.refresh()}
    />
  );
}
