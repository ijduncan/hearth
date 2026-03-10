import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { TodayClient } from "@/components/journal/TodayClient";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  // Fetch recent entries so client can match by local date
  const { data: recentEntries } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .order("entry_date", { ascending: false })
    .limit(3);

  return (
    <TodayClient
      profile={profile}
      recentEntries={recentEntries || []}
    />
  );
}
