interface StreakBadgeProps {
  count: number;
}

export function StreakBadge({ count }: StreakBadgeProps) {
  if (count === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 rounded-full">
      <span className="text-sm">🔥</span>
      <span className="text-sm font-medium">{count} day streak</span>
    </div>
  );
}
