import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { subDays, format } from "date-fns";
import { ExportView } from "@/components/export/ExportView";

export default async function ExportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    .select("display_name")
    .eq("id", user.id)
    .single();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-semibold">Export Report</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate a comprehensive report to share with your therapist or support person.
        </p>
      </div>
      <ExportView
        entries={entries || []}
        displayName={profile?.display_name || ""}
      />
    </div>
  );
}
