"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { MarkdownText } from "@/components/ai/MarkdownText";
import type { WeeklySummary as WeeklySummaryType } from "@/lib/types";

interface WeeklySummaryProps {
  summary: WeeklySummaryType | null;
}

export function WeeklySummary({ summary: initialSummary }: WeeklySummaryProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const data = await res.json();
        setSummary(data);
      }
    } catch {
      // silently fail
    }
    setGenerating(false);
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Weekly Reflection
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <div className="space-y-3">
            <MarkdownText className="font-serif">
              {summary.summary_text}
            </MarkdownText>
            {summary.avg_mood && (
              <p className="text-xs text-muted-foreground">
                Average mood: {summary.avg_mood}/10
              </p>
            )}
          </div>
        ) : (
          <div className="text-center space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              No summary for this week yet.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-2" />
                  Generating...
                </>
              ) : (
                "Generate now"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
