import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import type { SavedMoodTag } from "@/lib/types";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profileResult, moodTagsResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("saved_mood_tags")
      .select("id, user_id, label, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  return (
    <AppShell
      profile={profileResult.data}
      initialMoodTags={(moodTagsResult.data ?? []) as SavedMoodTag[]}
      moodTagsLoadFailed={Boolean(moodTagsResult.error)}
    >
      {children}
    </AppShell>
  );
}
