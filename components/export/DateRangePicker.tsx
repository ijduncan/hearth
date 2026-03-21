"use client";

import { useState } from "react";
import { format, subDays, subMonths } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import type { DateRange } from "react-day-picker";

interface DateRangePickerProps {
  value: { from: Date; to: Date };
  onChange: (range: { from: Date; to: Date }) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (range: DateRange | undefined) => {
    if (range?.from && range?.to) {
      onChange({ from: range.from, to: range.to });
    } else if (range?.from) {
      onChange({ from: range.from, to: range.from });
    }
  };

  const presets = [
    { label: "2 weeks", fn: () => onChange({ from: subDays(new Date(), 14), to: new Date() }) },
    { label: "1 month", fn: () => onChange({ from: subMonths(new Date(), 1), to: new Date() }) },
    { label: "3 months", fn: () => onChange({ from: subMonths(new Date(), 3), to: new Date() }) },
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="inline-flex items-center justify-start gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal hover:bg-accent hover:text-accent-foreground transition-colors"
      >
        <CalendarDays className="h-4 w-4" />
        {format(value.from, "MMM d")} – {format(value.to, "MMM d, yyyy")}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <div className="flex gap-1 pb-2 border-b mb-2">
          {presets.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                p.fn();
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          selected={{ from: value.from, to: value.to }}
          onSelect={handleSelect}
          numberOfMonths={1}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  );
}
