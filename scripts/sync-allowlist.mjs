import { createClient } from "@supabase/supabase-js";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ALLOWED_EMAILS",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const configuredEmails = [
  ...new Set(
    process.env.ALLOWED_EMAILS.split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  ),
];

if (configuredEmails.length === 0) {
  throw new Error("Refusing to sync an empty allowlist");
}
if (
  configuredEmails.some(
    (email) => email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  )
) {
  throw new Error("ALLOWED_EMAILS contains an invalid address");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { data: existing, error: readError } = await supabase
  .from("allowed_emails")
  .select("email");
if (readError) throw readError;

const { error: upsertError } = await supabase
  .from("allowed_emails")
  .upsert(
    configuredEmails.map((email) => ({ email })),
    { onConflict: "email" }
  );
if (upsertError) throw upsertError;

const configured = new Set(configuredEmails);
const staleEmails = (existing ?? [])
  .map((row) => row.email)
  .filter((email) => !configured.has(email));

if (staleEmails.length > 0) {
  const { error: deleteError } = await supabase
    .from("allowed_emails")
    .delete()
    .in("email", staleEmails);
  if (deleteError) throw deleteError;
}

console.log(
  JSON.stringify({
    configured: configuredEmails.length,
    removed: staleEmails.length,
  })
);
