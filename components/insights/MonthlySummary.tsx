"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, BookOpen } from "lucide-react";
import { MarkdownText } from "@/components/ai/MarkdownText";
import type { MonthlySummary as MonthlySummaryType } from "@/lib/types";

interface MonthlySummaryProps {
  summary: MonthlySummaryType | null;
}

export function MonthlySummary({ summary: initialSummary }: MonthlySummaryProps) {
  const [summary, setSummary] = useState(initialSummary);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/monthly-summary", {
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
          <BookOpen className="h-4 w-4 text-primary" />
          Monthly Reflection
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <div className="space-y-3">
            <MarkdownText className="font-serif">
              {summary.summary_text}
            </MarkdownText>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {summary.avg_mood && (
                <span>Avg mood: {summary.avg_mood}/10</span>
              )}
              {summary.total_entries && (
                <span>&middot; {summary.total_entries} entries</span>
              )}
            </div>
            {summary.dominant_tags && summary.dominant_tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {summary.dominant_tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              No monthly reflection yet.
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
