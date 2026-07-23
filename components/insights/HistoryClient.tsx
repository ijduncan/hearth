"use client";

import { useRouter } from "next/navigation";
import { HistoryView } from "./HistoryView";
import type { Entry } from "@/lib/types";

interface HistoryClientProps {
  entries: Entry[];
}

export function HistoryClient({ entries }: HistoryClientProps) {
  const router = useRouter();

  return (
    <HistoryView
      entries={entries}
      onEntrySaved={() => router.refresh()}
    />
  );
}
