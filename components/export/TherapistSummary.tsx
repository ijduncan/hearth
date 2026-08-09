"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MarkdownText } from "@/components/ai/MarkdownText";
import { Stethoscope } from "lucide-react";

interface TherapistSummaryProps {
  summary: string;
}

export function TherapistSummary({ summary }: TherapistSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4 text-primary" />
            Therapist Summary
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            AI-generated clinical summary for your mental health professional
          </p>
        </CardHeader>
        <CardContent>
          <MarkdownText>{summary}</MarkdownText>
        </CardContent>
      </Card>
    </motion.div>
  );
}
