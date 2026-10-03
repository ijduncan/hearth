import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PartnerPanel } from "@/components/partner/PartnerPanel";
import type { PartnerState } from "@/lib/types";

export default async function PartnerPage() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");
  const [state, entries] = await Promise.all([
    db.rpc("get_partner_state"),
    db.from("entries").select("id,entry_date").eq("user_id", user.id).order("entry_date", { ascending: false }).limit(30),
  ]);
  return <PartnerPanel initialState={state.error ? null : state.data as PartnerState} entries={entries.data ?? []} />;
}
