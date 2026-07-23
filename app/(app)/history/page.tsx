import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { HistoryClient } from "@/components/insights/HistoryClient";

export default async function HistoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: entries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-serif font-semibold">History</h1>
      <HistoryClient entries={entries || []} />
    </div>
  );
}
