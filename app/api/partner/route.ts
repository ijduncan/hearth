import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isTrustedMutation, readLimitedJson } from "@/lib/security";
import { parseJsonObject } from "@/lib/validation";
import { isUuid, validateGlimpse } from "@/lib/partner-validation";
import { sendPartnerInvitation } from "@/lib/partner-email";

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await db.rpc("get_partner_state");
  if (error) return NextResponse.json({ error: "Could not load connections" }, { status: 503 });
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isTrustedMutation(request)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = await readLimitedJson(request, 2048);
  const body = parsed.ok ? parseJsonObject(parsed.value) : null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (body.action === "invite") {
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    const { data, error } = await db.rpc("invite_partner", { p_email: email });
    if (error) return rpcError(error);
    // The database resolves eligible existing users. Do not send unsolicited
    // invitations to arbitrary addresses or turn this into an account lookup.
    const delivery = data?.id ? await sendPartnerInvitation(email, data.id) : "sent";
    return NextResponse.json({ message: delivery === "sent"
      ? "If this person has an eligible Hearth account, their invitation is ready in Hearth and an email was requested."
      : "The invitation is available in Hearth. Email could not be sent; ask your partner to open Partner in Hearth." });
  }
  if (!isUuid(body.id)) return NextResponse.json({ error: "Invalid connection" }, { status: 400 });
  let result;
  switch (body.action) {
    case "accept":
    case "decline":
      result = await db.rpc("respond_partner_invitation", { p_id: body.id, p_accept: body.action === "accept" });
      break;
    case "disconnect":
    case "cancel":
      result = await db.rpc("remove_partner_connection", { p_id: body.id });
      break;
    case "withdraw":
      result = await db.rpc("withdraw_partner_glimpse", { p_connection_id: body.id });
      break;
    case "share": {
      const text = validateGlimpse(body.text);
      if (!text || !isUuid(body.entryId)) return NextResponse.json({ error: "Use one sentence of at most 15 words and choose a saved entry" }, { status: 400 });
      result = await db.rpc("share_partner_glimpse", { p_connection_id: body.id, p_entry_id: body.entryId, p_text: text });
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  if (result.error) return rpcError(result.error);
  return NextResponse.json({ ok: true });
}

function rpcError(error: { code?: string; message: string }) {
  const expected = error.code === "22023" || error.code === "P0001";
  return NextResponse.json({ error: expected ? error.message : "This connection is unavailable. Refresh and try again." },
    { status: error.code === "42501" ? 403 : expected ? 400 : 503 });
}
