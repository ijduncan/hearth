import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { subDays, format, startOfWeek, startOfMonth } from "date-fns";
import { InsightsView } from "@/components/insights/InsightsView";

export default async function InsightsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const oneYearAgo = format(subDays(new Date(), 365), "yyyy-MM-dd");

  const { data: entries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .gte("entry_date", oneYearAgo)
    .order("entry_date");

  const { data: profile } = await supabase
    .from("profiles")
    .select("streak_count")
    .eq("id", user.id)
    .single();

  // Get current week's summary
  const now = new Date();
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd");

  const { data: weeklySummary } = await supabase
    .from("weekly_summaries")
    .select("*")
    .eq("user_id", user.id)
    .eq("week_start", weekStart)
    .single();

  // Get current month's summary
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");

  const { data: monthlySummary } = await supabase
    .from("monthly_summaries")
    .select("*")
    .eq("user_id", user.id)
    .eq("month_start", monthStart)
    .single();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif font-semibold">Insights</h1>
      <InsightsView
        entries={entries || []}
        streakCount={profile?.streak_count || 0}
        weeklySummary={weeklySummary}
        monthlySummary={monthlySummary}
      />
    </div>
  );
}
