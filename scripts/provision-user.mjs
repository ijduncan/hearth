import { createClient } from "@supabase/supabase-js";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const email = process.argv[2]?.trim().toLowerCase();
if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Usage: npm run security:provision-user -- user@example.com");
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const { data: allowed, error: allowlistError } = await supabase
  .from("allowed_emails")
  .select("email")
  .eq("email", email)
  .maybeSingle();
if (allowlistError) throw allowlistError;
if (!allowed) {
  throw new Error("Refusing to provision an address that is not allowlisted");
}

let existingUser = null;
for (let page = 1; page <= 100; page += 1) {
  const { data, error } = await supabase.auth.admin.listUsers({
    page,
    perPage: 1000,
  });
  if (error) throw error;

  existingUser = data.users.find(
    (user) => user.email?.trim().toLowerCase() === email
  );
  if (existingUser || data.users.length < 1000) break;
}

if (existingUser) {
  console.log(JSON.stringify({ provisioned: 0, alreadyExists: 1 }));
  process.exit(0);
}

const { error: createError } = await supabase.auth.admin.createUser({
  email,
  email_confirm: true,
});
if (createError) throw createError;

console.log(JSON.stringify({ provisioned: 1, alreadyExists: 0 }));
