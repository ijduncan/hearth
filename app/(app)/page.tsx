import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getTodaysPrompt } from "@/lib/prompts";
import { EntryForm } from "@/components/journal/EntryForm";
import { format } from "date-fns";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const today = format(new Date(), "yyyy-MM-dd");

  const { data: existingEntry } = await supabase
    .from("entries")
    .select("*")
    .eq("user_id", user.id)
    .eq("entry_date", today)
    .single();

  const todaysPrompt = getTodaysPrompt();

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-serif font-semibold">
          Good evening{profile?.display_name ? `, ${profile.display_name}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), "EEEE, MMMM d")}
        </p>
      </div>
      <EntryForm
        todaysPrompt={todaysPrompt}
        existingEntry={existingEntry}
        profileName={profile?.display_name || "friend"}
      />
    </div>
  );
}
